# AGENTS.md

Canonical rulebook for AI coding agents (Claude Code, Codex, ...) in this repo. It is the single source: there is no CLAUDE.md, and adding one splits the guidance.

## Project

OpenAlpha is an AI trading research analyst. It suggests by default and executes only through `/trade` / `order_place`. Human-in-the-loop is the product.

- Screens, scores, sizes and debates trade ideas across markets (VN equities, gold, crypto).
- Delivers suggestions (entry, stop, target, R:R, conviction, thesis with sources), keeps an honest ledger of the operator's trades, tracks how past suggestions performed.
- Surfaces: CLI and Telegram/Zalo.

## Design goals

- Smallest coherent system that preserves the business invariants. Fewer concepts, policies and lifecycle owners beat fewer lines bought with hidden coupling.
- One policy, one owner, one enforcement path. Registration, help, menus, authorization, persistence predicates, retries, accounting, rendering and cleanup derive from their canonical contract; no surface or producer reimplements them.
- Extend locally. A new command, provider, channel or agent adds its implementation plus a composition registration; it does not edit central per-implementation switches or unions, duplicated locale renderers, or unrelated modules. Closed unions only for genuinely closed protocol states.
- Hot paths stay direct and bounded. No indirection, cache, background work or generic framework without a current measured need and two concrete consumers.
- Delete replaced shapes and orphaned helpers in the same change. No compatibility or data-migration shims unless the user asks (schema changes follow the migration rules).
- Write for a reader six months later: explicit ownership, boring control flow, consistent names, small public surfaces, errors that name the failed boundary without leaking sensitive data.

## Rule precedence

1. The user's explicit instruction in the current conversation.
2. This file.
3. Tool defaults (Biome, TypeScript).

In doubt: stop and ask. Never silently pick.

## Commands

```bash
bun run lint            # Biome lint + autofix
bun run typecheck       # gen + tsc (Bun never type-checks; the only type gate)
bun run check           # Biome + typecheck + contract gates (CI)
bun run lint:arch       # depth, trading/registry/feature isolation, locale, report figures,
                        # caveats, vi terminology, pricing, agent skills, strategy version (CI)
bun run gen             # regenerate the migration registry
bun run migration:new   # scaffold a migration
bun scripts/check-strategy-version.ts --write   # re-record policy digests
```

## Packages

```
src/       # engine, cli, trading, channels, persistence, ai, memory, plugins, social, ...
scripts/   # the gate suite (`bun run check`, `bun run lint:arch`)
```

A client app talks to the `/v1` HTTP/WS API in `src/app/server/` (contract: `src/app/server/CONTRACT.md`).

## Architecture

### Module DAG

15 modules in `src/`, acyclic, every edge points toward `core`.

| Module | May import | Role |
|---|---|---|
| `core` | nothing | Kernel: errors, config, DI, security, seam interfaces. No finance vocabulary |
| `i18n` | nothing at runtime | Localization leaf (one erased `Locale` type import from core) |
| `ai` | core | LLM transports, fallback chain, catalog, pricing |
| `engine` | core, ai | Agent loop, hooks, compact, skills |
| `tools` | core, engine | Built-in agent tools |
| `persistence` | core | SQL engines (sqlite/postgres), migrations, stores |
| `memory` | core | KV with secret scrubbing (`FtsSearch` interface) |
| `scheduler` | core, engine | Cron/heartbeat |
| `commands` | core, engine, scheduler | Slash dispatcher + core commands |
| `plugins` | core, engine | Discover/install/merge + trust model |
| `social` | core, engine, i18n | Agent social networks joined by skill |
| `trading` | core, engine, persistence, i18n | Self-contained bounded context |
| `channels` | core, engine, commands, i18n | Channel definitions, delivery, adapters |
| `cli` | all except `app` | Terminal surface |
| `app` | all | Entry and sole composition root |

Boundary rules (hard):

1. A module's public API is `@/<module>/api` and nothing deeper. No internal barrels, no `export *`.
2. Kernel exception: `core` and `i18n` have no `api.ts` (it would close a cycle and force every consumer to load `zod`/`pino`/`undici`).
   - `core`'s public surface is enumerated in `CORE_PUBLIC` (`scripts/check-dag.ts`); consumers deep-import it (`@/core/errors`). A new `core/` file is internal until added there; that edit is the reviewable act of widening the kernel.
   - Internal: `core/ssrf/{ipv4,ipv6,dns,ssrf}` (facades `ssrf/network-policy`, `ssrf/pinned-fetch`), `core/security/prompt-injection` (facade `security/sanitize`), `core/config/{schema,paths}` (facades `config/load`, `config/resolve`). Import the facade.
   - A public facade with no callers yet (`config/load`, `ssrf/network-policy`, `security/binary`) stays in `CORE_PUBLIC`.
   - `i18n` exposes only bare `@/i18n`; it may `import type` only `Locale` from `@/core/types/locale`.
3. Consumer-side interfaces at every seam: consumer defines, provider `implements`, `app` binds. Direct dependencies only between always-coexisting modules.
4. `core` has no finance vocabulary. Nothing imports `trading` except `app`, `cli` (via its public API) and the SDK barrel.
5. Domain modules never import surfaces (`cli`, `channels`, `server`). Surfaces never import `app`.
6. No `RunContext` god-object: the Run owns its state; services are injected.
7. Provider order in `app/providers.ts` is load-bearing (prologue + 15 steps, 9 constraints, incl. step 8b `cliCommands`). Read it before reordering.

### Trading layout

`src/trading/`: `kernel/` (shared types and seam interfaces), `features/` (`alerts`, `brief`, `ledger`, `market-data`, `order`, `portfolio`, `profile`, `suggestion`, `themes`), `markets/`, `venues/`, `sources/` (`adapters/`, `routes.ts`), `render/` (display contract), `wiring/` (`composition/`, `catalog/`, `config-defaults.ts`), `agents/` (personas), `skills/`.

- `scripts/check-feature-isolation.ts` holds the slices: `kernel/` and `render/` are leaves, a feature reaches only the features its row names, only `wiring/` calls a service factory. Its allowlist (`scripts/feature-isolation-allowlist.json`) only shrinks.
- A kernel file never imports a feature. A seam between features is a consumer-side interface bound in `wiring/`.

### Markets

Enforced by `scripts/check-registry-isolation.ts`.

Layout:
- One folder per market, named by its `MarketRef`: `markets/{gold,gold-vn,equity-vn,crypto}/`.
- `market.ts` exports `create*Market`; it is the only file code outside `markets/` may import.
- `api.ts` is the only file a sibling market may import, and exists only where one market derives from another (`gold-vn` prices a premium over `gold`).
- Helpers all markets share live at the `markets/` root (`factor-scoring`, `levels`, `calendar`, `timeseries`); family-specific code stays in its market, published via its `api.ts`.

Resolution and regions:
- Resolution is local-first. `manifest.detection` is `'stored' | 'fetched'` (where `detect` reads from); declare `stored` only for a detector that does not fetch.
- An unqualified ticker asks stored markets first; one match ends it. The operator names the other market to reach it (`/suggest crypto:HDB`). Ambiguity is reported only within one tier.
- One market speaks for each region: `ownsRegion` elects it; boot rejects none or two. Its calendar is the region's trading day and its macro capability the region's composite. Never pick a market by registration order for a region-level read.
- A non-owner market declaring `macroRisk` still gates its own segment and publishes the composite on its `/overview` block (`MarketDataOverview.macro`). A read that gates must be printed.
- A region's regime reads its own market first: driver tables sit beside the policy (`VN_MACRO_DRIVERS`, `CRYPTO_MACRO_DRIVERS`); `US_MACRO_DRIVERS` is what US-priced segments read. A table weighing a US series takes its band from `US_DRIVER_BANDS`. VN stress confirmers only lower what its drivers produce.

Calendars:
- A market's weekend is what its tape publishes, verified, not assumed from the asset class (VN gold quotes Saturdays). `isSettled` requires `isTradingDay`, so a wrong weekend silently drops days.
- Session-counted tolerances (`WORLD_CLOSE_LAG_SESSIONS`, `FX_LAG_SESSIONS`) read the same calendar; changing the weekend rule re-derives them in the same commit.
- Exchange closures are calendar: `CalendarPolicy.holidays` (`markets/equity-vn/holidays.ts`). A holiday is never a settled session.
- Operators add closures under `[trading.markets.<id>] holidays`; `createTradingCalendar` layers them on the table, never replaces it; boot refuses one on the market's own weekend. Boot logs `trading.holidays_outdated` when the newest date is in a past year.
- Another market's bars are counted on that market's calendar, never the caller's.

Data semantics:
- `VenueInstrument.market` is required; `readListing` filters on it (a venue serving several markets attributes each catalog row).
- A market's `bars` capability serves the settled series through `settledBars`. Levels, trail, factors and outcomes read it (a forming bar shrinks ATR). The live price is the quote capability's job.
- A return is neutral at zero: factors read off a return score via `returnBand` (clips at the measured envelope, pins zero to neutral). A linear band states `neutralAt` where neutral is not its midpoint.

Strategy versions:
- `check-strategy-version` digests each market's `<MARKET>_LEVEL_POLICY`, `*_FACTOR_POLICY`, `*_ACCOUNTS_POLICY` literals and the `*_RANGE`, `*_CAP`, `*_PCT`, `*_FALLBACK` bounds beside them, grouped by `<MARKET>_STRATEGY_VERSION`.
- Changing a multiplier, factor weight, normalization bound or conviction cut point bumps that market's version in the same commit; then re-record with `--write`. `gold-vn` shares `GOLD_STRATEGY_VERSION`.
- Declaring a `trail` is such a change (it raises a held stop and clamps a fresh entry's stop, moving the printed R:R).
- Operator level keys (`[trading.markets.<id>] maximum_stop_loss`, `stop_loss_atr`, `reward_risk`) are the one runtime exception: `resolveLevelPolicy` lays them over the code policy and `strategyVersionOf` suffixes the version with their fingerprint.
- The version keeps a superseded row on the book: `lookbackOf` carries it into reuse lookups (an old-version suggestion is never served as today's answer) and `groupByVersion` reports the track record per version.
- Never reset the database for a policy change. Reset for a schema change; bump the version for a policy change. There is no backtest; calibration needs a forward sample.

### Adding a market

Anything not listed is derived or gate-checked.

1. `markets/<ref>/market.ts` exporting `create<Name>Market(deps: MarketDeps): Market` (manifest, capabilities, `candidacy`, `detect`, `factors`, `levels`). Calendar: `createTradingCalendar(policy, config.markets[<ref>]?.holidays)`; published holidays go in `markets/<ref>/holidays.ts`.
2. Factor id tuple and a `FactorId` union arm in `trading/kernel/factor.ts` (`manifest.factorIds` is typed against it). The central edit is deliberate: a market with new factor ids ships in-tree, never as a plugin.
3. One `markets.register(...)` line in `trading/wiring/composition/registration.ts`.
4. Providers under `sources/`, routed in `SOURCE_ROUTES`, registered in `trading/wiring/composition/source-registry.ts`.
5. Locale keys in both `src/i18n/locales/en.json` and `vi.json`: `trading.market.<ref>`, `trading.region.<region>`, `trading.segment.<segment>`, `trading.factor.<id>` per factor. Composition throws listing what is missing.
6. A venue that lists it. A market no venue holds is read for reference only (world gold): its segment stays off (`SegmentDescriptor.held`) and `/profile enable` refuses it.
7. `manifest.playbook`: skills for debate roles, split into `analysis` and `execution` (omit `execution` if orders carry no rules). Typed against `SkillName`.

`Region` and `PortfolioSegment` are brands (nothing to widen); `AssetClass` is closed. `MarketRegistry.register` rejects a duplicate `id`, `(region, assetClass)` or `segment`, and a second `ownsRegion` in a region.

### Venues

A venue is where the operator's assets sit, modelled like a market.

- Same isolation gate: outside code imports `venues/<id>/venue.ts` only; no venue imports another, so venues have no `api.ts`. Shared plumbing (`venues/client-order-id.ts`, `venues/transport.ts`) sits at the `venues/` root; retry, budgets and timeouts come from `transport.ts`, never per venue.
- `venue.ts` exports `create<Name>Venue(input): Venue` (manifest + the `SpotAdapter` the order path speaks through). A hand-traded venue has no adapter (`createManualVenue`); routing never selects it.
- The OKX folder is the template: `venue.ts`, `spot.ts`, `transport.ts`, `sign.ts`, `symbol.ts`, `receipt.ts`, `catalog.ts`, `history.ts`, `open-exits.ts`, `stops.ts`.
- `kernel/venue/spot-adapter.ts` owns the capability interface and order vocabulary (`OrderSide`, `OrderState`, `OrderReceipt`, `InstrumentLimits`, `FilledOrderLookup`); `features/order/types.ts` re-exports it. `fetchFilledOrders` is called by no order path: it lets `/record` take a hand-made trade's figures from the exchange.
- Exchange wire names stay in `venues/<id>/` (`instId`, `ordId`, `clOrdId`, `ordType`, `algoId`, `algoClOrdId`); outside it say `symbol`, `orderId`, `clientOrderId`, `orderType`, `exitId`, `exitClientId`. Wire shapes (`toSymbol`, `toClientOrderId`) are adapter methods. The venue resolves its own credential keys inside its factory.
- Capabilities are declared, not probed: `manifest.execution` (`VenueExecution`: rests exits, `amend`, fill listing, balances); `venues/registry.ts` refuses a manifest/adapter mismatch. Binance rests exits it cannot move (`/trade exit` over one is refused with `order.exit_not_amendable`, naming `/trade cancel`) and lists fills per symbol (`fills: 'by-symbol'`; the sync passes the book's symbols via `FilledOrderWindow.symbols` plus held assets, and the reply says an unnamed coin's round trip was not read).
- A built-in exchange booted without its key has no adapter, as a hand-traded venue has none; `manifest.missingCredentials` (the unset variable names) is what tells them apart, and `/reconcile` and `/record sync` read it. `VenueRegistry.heldMarkets()` is the one answer to which markets a venue holds.

Configuration (`[trading.venues.<id>]`: `default_for`, `markets`, `fees`, `credentials`, `simulated`):
- `resolveTradingConfig` derives `TradingConfig.venues`, `.costs`, `.defaultVenues` from it in one place.
- An id outside `BUILT_IN_VENUES` is a hand-traded broker: `buildVenues` uses `createManualVenue`; markets are `markets`, else `default_for`; `fees` is mandatory (boot refuses otherwise). It has no catalog name (`renderVenueName` prints the id in capitals), so the locale gate covers `BUILT_IN_VENUES` only.
- A built-in venue may not set `markets`; its `fees` replaces built-in rates whole. Two venues claiming one market in `default_for` is a boot error.

Adding a venue: its folder (or one `createManualVenue` line); one `venues.register(...)` line in `trading/wiring/composition/venues.ts`; its id in `BUILT_IN_VENUES` plus fee entry and default markets in `trading/wiring/config-defaults.ts`; `trading.venue.<id>` in both catalogs. Composition throws naming offenders for a `(venue, market)` pair with an unbuilt market, a `default_for` venue not holding the market, or a missing catalog key.

Reads and routing:
- A read that merges venues states its rule (`readListing().prices` takes the first in registration order).
- A read that can fail says so in its type and each caller states which way it errs: `catalogRows` returns `undefined` for an absent or unreadable catalog, never `[]`; floor reads (`venueMinimumSizes`, `minimumSizesByInstrument`) err toward no floor.
- Every instrument-bearing ledger row (splits and stock dividends too) names a registered venue holding the row's market; checked in `ledger/validate.ts`, never in the pure, config-free parser.
- Routing is `features/order/routing.ts` only. `resolveOrderVenue`: a named venue narrows to itself; a sell narrows to venues that can fill it (settled quantity no resting exit froze); anything but exactly one candidate is refused with the list; a name held everywhere but sellable nowhere is refused before routing. `adapterFor` addresses the venue a stored row names (confirm and exit cancel never re-derive it). Two live exits on one instrument need `/trade cancel <venue:ticker>`.
- Assets cannot move between venues (shipped limitation); a book whose coins moved is wrong until the operator edits rows.

### Sources

A source feeds the evidence pipeline (stored, provenance-stamped, factor-scored, cited), a higher bar than an agent tool.

- Evidence-grade data is a first-party adapter (`sources/adapters/`) with parser, schema, rate limit and failover route. Data the agent reads but never derives from is an MCP tool the operator connects.
- `SOURCE_ROUTES` owns which providers serve which scope, in order; `covers` answers only whether a request's shape is servable. A source may read `context.market` to stamp what it parsed; it never tests it to decide whether it serves and never constructs a `MarketRef` or `Region`.
- Endpoints, rate limits and credential variable names are code-owned (`SourceFacts`): no config can redirect a request; credentials come only from the environment. News: `RSS_FEEDS` is the allowlist and the URL is the pinned target. Outbound requests use `BROWSER_HEADERS` (`core/http-client.ts`).
- Route order ranks quality: a provider that answers wrongly without failing sits behind one that does not (`vietcap-chart` leads `entrade` for both VN level kinds). An adapter refuses a level series holding a frozen bar rather than serving it short, and the market ages every reading.
- A transport code never reaches the operator raw: `SourceSummary.lastFailureCode` is a `CaveatCode`, rendered by `/sources` as `trading.source.failure.<code>` via `renderProvidedValue`.
- A refresh pass counts what the store wrote, not what it handed over: without `force` a held day is kept (`ON CONFLICT DO NOTHING`); `upsertSeriesPoint` says whether the row landed.
- A refresh re-asks an overlapping tail; a changed close on a held day is a restatement:
  - `isRestated` / `RESTATEMENT_TAIL_SESSIONS` live in `markets/bar-restatement.ts`; `isRestated` compares against every stored close the tail overlaps (`listBarCloses`), never the newest alone.
  - The window is refetched on the new basis and named in `restatedTargets`. Open plans on the old basis close; every hold on the name is deleted; a restated call is never the floor a new stop ratchets to.
  - A closed call keeps `return_pct` null (reads as `restatedAt`): out of every scored population, counted apart by `/reflect`, and `isStandingAnswer` refuses its old-basis levels. The scorer closes calls the same way via `isRestatedSince`. Crypto is excluded.
- Every `news` result passes through `withNewsArchive` (`wiring/composition/news-archive.ts`) into `news_items` (one row per canonical URL, title and summary only), kept `NEWS_RETENTION_MS` by `fetched_at`, pruned by one global delete in `features/market-data/ops/retention.ts`. A failed archive write is logged, never fails the read.

Adding a data source: adapter in `trading/sources/adapters/` built with `createSource` / `parsedSource` (`sources/define.ts`), with parser and schema; route in `SOURCE_ROUTES` (`sources/routes.ts`); register in `trading/wiring/composition/source-registry.ts`.

- Adapter notes (`vietcap-statements`, `sbv`, `nso`, `commodityPrices`, `valuationRatios`, `trading.macro-extract`): a bank is read from its balance sheet, never its sector; never read the provider's operating profit or store its EPS; a line the provider stops filling reads as absent; a macro figure is kept only if its quote is verbatim in the source. Details: [docs/en/dev/data-sources.md](docs/en/dev/data-sources.md#route-order-and-adapter-notes).

### Plugin sources

A plugin adds a provider with `sources.ts` at its root (presence is the declaration; no manifest section).

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

- The module imports nothing: `kit.define` is `createSource` with id and pinned transport bound; `kit.ok` is `parsedSource` (a compiled binary cannot resolve a user file's runtime specifiers).
- Requires `plugins.allow_code = true`, separate from `allow_untrusted`. Plugin code can do anything the process can; the endpoint constrains only an honest plugin. `allow_code` is the consent boundary.
- A plugin route may open a scope no built-in serves or stand behind an existing one; never tried first. A built-in's id is refused.
- Any failure (unreadable module, throwing import, timeout, bad manifest, id collision, a defined kind its routes do not cover) logs `trading.plugin_source_skipped` and drops that plugin; boot continues.

### Adding a command, tool, channel or agent

Implementation plus one composition registration; defining does not activate.

- Trading slash command: `features/<feature>/command.ts` (or `command/<name>.ts`) exporting `create<Name>Command`; register in `createTradingCommands` (`trading/wiring/catalog/commands.ts`); strings in both catalogs; arguments follow the Operator argument grammar. Generic slash command: `createSlashCommand`, registered via a `boot` option or `ServiceProvider`. Terminal command: `createCommand`, contributed through `cliCommands` (step 8b).
- Tool: `createTool`; trading tools register in `createTradingTools` (`trading/wiring/catalog/tools.ts`). No tool names an absolute read (`check-feature-isolation`).
- Channel: `ChannelDefinition` + `ChannelAdapter` behind `channels/api.ts`, in `channels/adapters/<name>/`. Keep transport parsing, rendering and credentials in that folder; declare truthful capabilities; enforce `maxTextLen` in the renderer; accept the shutdown signal before arming listeners or polling; register at composition (normally a trusted bundled plugin); config and doctor validation go through the definition's schema path. No per-channel `if` in delivery, command, approval or persistence code: add the missing capability to `ChannelCapabilities`.
- Agent: a TOML file, not code (`AgentTomlSchema`, `src/engine/agents/builder.ts`; template `agent.sample.toml`). Trading debate personas: `src/trading/agents/<id>/agent.toml`, loaded by role in `trading/wiring/catalog/agents.ts` (keyed by `DebateRole`). User agents: `<data_dir>/agents/<id>/agent.toml`, untrusted. Code-defined untrusted agents: `createAgent`.

### Persistence and migrations

- `src/persistence/migrations/registry.generated.ts` is generated; never edit it. Add `YYYY_MM_DD_HHMMSS_description.ts` (`bun run migration:new`), then `bun run gen`.
- The runner applies only IDs absent from `_migrations`; that table's name and statements are exported from `migrations/runner.ts` (`doctor` reads it through a raw readonly `bun:sqlite` handle, so the SQL must stay shared).
- Migrations are immutable from 1.0.0: an applied migration file and ID never change; every schema change is a new file; `down` is written at birth. `openalpha upgrade` runs new binaries on databases nobody can reset. `check-migration-rollback` enforces `down` (static table coverage plus a sqlite round trip). Baseline files are the 1.0.0 schema.
- A migration stays readable by the previous release (expand, then contract a release later): `upgrade --rollback` takes the schema back only after an `upgrade` recorded it (never after an install-script install), and `migrate` refuses a database carrying IDs this release does not declare. Change a column's meaning by adding a new one first; drop or repurpose the old one in a later release.
- Adding a table is three edits: `CREATE TABLE` in the migration, its name in that migration's `TABLES_TO_DROP`, one `{ name, pk, durable? }` line in `persistence/tables.ts`. That registry drives `db stats`, `db export` paging, `db import` order and retention delete keys, and is the only place a primary key is written outside the DDL. `check-table-registry` holds it against a throwaway sqlite database (Postgres DDL via recorded `up` runs). `durable` means the row survives a reset only if exported (operator-written or not refetchable); no catalog derives it.
- Retention is per scope: `resolveRetentionMs` sizes the sweep from the longest bar window (anything a refetch rebuilds); `retentionMsOf` (beside `RETENTION_SCOPES`, `features/market-data/store/market-data.ts`) holds the exception, `ARCHIVED_RETENTION_SCOPES` (what a provider never serves again), kept five years. `durable` and archived are different questions (`daily_trade_sides` is durable and short-lived). `annualAccounts` is neither.
- Keep fundamental-snapshot re-stamps (`findLatestFundamental` answers point-in-time from them; the write path never deletes). Do not build a sweep of superseded re-stamps past `MAXIMUM_OUTCOME_LOOKBACK_DAYS` until stores are large enough to pay for it.

### Themes

- `features/themes/` keeps the operator's theme list; code mints every evidence id and scores every read, the model never scores, and a run writes nothing until every step answered. Details: [docs/en/trading.md](docs/en/trading.md#themes).

### Settled decisions

Decided; do not re-litigate or re-add.

- No auto-execution and no second path to an exchange: the only path is `/trade` / `order_place` via `VenueRegistry`.
- No backtest harness: calibration is forward track record only (`/reflect`).
- No speculative abstraction: no indirection, cache or framework without a measured need and two consumers.
- No widening a gate to land a change: thresholds ratchet one way; split the file.
- No config that redirects a network request: endpoints stay in code.
- No declarative source routing in `plugin.toml` (a route asserts an adapter can address instruments in a market, which only code knows; a mapping-less route stores the wrong instrument as evidence).
- No operator-declared custom sources with field mapping (providers need conversions such as epoch ms to a trading day; that is a language in TOML).
- No per-market source folders (sources are shared; the depth ceiling rejects `markets/<ref>/sources/<provider>/`).
- No breakeven stop: nothing moves a stop to entry or cost, and no plan, hold level or alert asks for one (it cut more winners than it saved).
- No thesis-percentage tie-out check against levels (personas state no level). `isLevelRestatement` stays: it guards invalidators, not prose.

## Business invariants (never break)

### Execution and orders

- Suggest by default. The only execution path is `/trade` / `order_place`: one `SpotAdapter` per venue behind `VenueRegistry`, one shared service, no order code elsewhere.
- Every order routes to exactly one venue (refused if several could fill it), is approved and capped, and is mirrored in the ledger. An approved entry may leave one resting take-profit/stop-loss.
- `/trade exit` sets or moves that exit on a held position: sized from the ledger fold unless a smaller coverage is named, never above what the venue holds; amended in place only where the leg shape matches and `VenueExecution.amend` allows, otherwise refused, never replaced. Only `/trade cancel` removes protection.
- Serialize every exchange write; re-read whole-book caps inside that window.
- A buying halt lives in `order_settings`, is checked in `execute()` for buys only, and never cancels a resting exit or calls cancel-all.
- Human approval gates dangerous tools; approval state is session-scoped. Every approval surface (MCP form included) offers exactly `decisionsFor`'s choices.

### Stops, plans and levels

Stop vs resting exit:
- A plan's stop is not a stop at an exchange. `StopDistance` is the latest suggestion's level; `RestingExit` is an order at a venue. A holding can carry the first with nothing behind it (`order.exit_failed`, a hand-recorded trade, `/trade cancel`).
- `StopDistance.plan` is `none` (no plan, or no stop) or `distance` (the latest plan's level, holds included: every spot holding is long, so its hold plan is an exit plan) - only if the plan is framed as a buy. A blocked reduce is stored as a hold keeping its levels' side, so `findLatestExitPlan` selects the newest buy or hold framing a long with a stop by `framedDirectionOf`, never by action; a name whose only plan prices a sale reads `none`, except a same-day row that took over the plan's row (a sale, or a run that priced no levels): it answers through its `standingExit`, which the trail never raises.
- The level is `planStopOf` (plan stop or the tick-trailed one). A surface printing the planned state says whether one actually rests at the venue. A hold's bare level has no third arm: armed or `reviewOnly`.

Trail:
- The exit tick writes `trailing_stop` upward only, from the market's `trail` on the settled series, rounded to the instrument's tick grid (`Market.tickSizeOf`); it never sits within `minimumStopMultiplier` ATRs of the last close.
- Every raise (tick, or a suggestion lifting a held stop via `raisedStopFrom`) names the `/trade exit` that moves the resting order; none follows it.
- The scorer replays the trail on stored bars from the first session under the same `resolveTrailBounds`; it never reads the column.
- Nothing moves a stop to entry or cost. A held name arms only its stop and take-profit.

Scoring a call:
- An order that traded in its own session (`orderSession === at`) on a live price is graded from entry to that session's close (only the stretch the fill travelled; a close already through a level exits at the level). If that session never printed the entry, the call meets the whole session from its open, gap included. The benchmark starts on the close the window starts from.
- Exit ladder: a buy stamps the profile's `takeProfitTranchePct`; the scorer banks that share at `takeProfit` and the rest rides the trail (row pending until the rest closes or the window ends). A review level, a no-trail market, a reduce and a row stamped before the tranche exit whole at the target.
- `takeProfit` is where `takeProfitRiskMultiplier` banks the share (one risk unit out on VN shares, long crypto, long gold); it is the target where the policy names none (`VN_FUND_LEVEL_POLICY` names none).
- `TradeLevels.reviewOnly` marks a level with nothing armed; the row carries `reviewOnly`; `armsExit` reads only that. A VN fund is reviewed, never stopped: closed at the target or the window's last close.

Gates and ratios:
- R:R and reward gates read the target, except the break-even probability floor, which reads the first exit over entry-relative risk net of the round trip the scorer charges and the cost line prints (`marketTradeCost` at the market's default venue). The void line (don't-chase price, `levels-void`) follows the same rule but never sits past the take-profit.
- Only the headline, a hold's levels and the stake line are priced at the first exit (`firstExitRiskReward`: whole position marked at `takeProfit` where a tranche banks), and say so.
- Size is budgeted on the entry-relative stop distance (`TradeLevels.riskDistance`), never a trail- or ratchet-moved stop.

Plan lifecycle:
- A held name never lacks a plan longer than one alert tick: `ExitPlanner` writes a `recorded-entry` hold at the fill price on the write path and from the settled close on the tick (the board's two sides where bars are another instrument's tape). One insert; never over a plan the watched price has not passed; never as today's `/suggest` answer.
- A plan belongs to the holding as it stands: every exit-plan read passes `heldSince`. A holding opens at the latest buy landing on nothing or on residue below the venue minimum (`PositionBuy`, `toCurrentCycles`); its sold-since-opened count starts there. `isStandingAnswer` is the one gate for reuse, replace and cooldown.
- The arming pass reads the live book while the row prints its stored snapshot (an add moves the armed level a tick before the printed one).
- A plan spent at its target re-plans from the current close, lifting the fresh stop by the whole distance travelled, so changing `targetRiskMultiplier` changes how far held stops jump.
- Only a run that asks the planner rolls a plan; the alert tick asks only when no plan stands (`expectedDrafts`, `isSpent`), so the roll happens on the daily `/suggest` the brief runs. Between runs the trail moves the stop and the alert carries the crossing. Generation stays end-of-day; a tick must not re-price standing plans.
- A held plan keeps its take-profit until the first tranche sells: `keepTakeProfit` (`exit-plan/ratchet.ts`) carries it into `standingTakeProfit` on both writers. Held surfaces and exit alerts read `planTakeProfitOf`; gates, void line and scorer read the fresh `takeProfit`.

### Suggestion pipeline

- Stages: detect, factors, debate, stages, persist. A blocked stage forces hold. A scheduled delisting or last trading day holds a buy (`draftDirectionFor`); selling out stays open. A stage dated by when an order trades reads `orderSessionOf`, never the run's calendar day.
- Conviction only lowers, and so does size. The realized-record scale caps the conviction multiplier and never raises it; it reads only the population stamped with this run's calculation versions, counted in independent calls (`independentCalls` folds a repeat of a still-open call on the same name and side into the first, as every track-record rate does).
- The segment's regime scale attenuates final size beside conviction and intent, not inside the cash ceiling. A segment's unfunded appetite is named per segment (each gets its own slice of the pool).
- Open risk is whole-book: `openRiskOf` sums `units x (mark - planned stop)` over priced tradeable holdings once per instrument across venues; a buy is sized into the room under `maximumOpenRiskPctNav`. A held name with no planned stop makes it a floor and is named (`suggestion.open-risk-unplanned`), never zero.
- A fund answers to its segment's ETF ceiling instead of the single-name cap where declared (`positionCapOf`, `isCappedAsFund`).
- The book never reads a suggestion row: it states the seam (`ReduceVerdicts`), `app` binds it.
- A stored suggestion carries `held` and `evidenceThrough` on both arms (`SuggestionBase`; `sharedPayload` writes, `toBase` reads; the report's closing lines print `evidenceThrough` wherever it differs from `at`). `settlement`, `priceBand`, `concentration` stay on the actionable arm.

Reduce reasons:
- `reduce` carries a `reduceReasonCode`: `over-target` (the plan's trim), `weak-signal` (the plan's exit below the weak-holding line) and `over-cap` (a sale back to a cap the name ran past) are the plan's own; `structure-broken`, `regime-risk-off`, `thesis-weakening`, `overheated`, `stale`, `ceiling-close` are evidence turning on a held name.
- An evidence reason cuts to what its share leaves of the position as opened; what was sold since opening counts, so a true reason sells once, then holds as `evidence-sold`; a share still owed but under one board lot holds as `sale-below-board-lot`. A trim and an evidence reason are weighed in board lots, not ordered: the larger sale wins and carries its reason (a tie goes to the evidence), so a full exit is never filed as a routine trim.
- `structure-broken` and `overheated` come from `crypto` alone (the Turtle exit its Donchian entry earns); do not transplant a full-exit trigger into a market whose entry is not a breakout without a record to fit it. `regime-risk-off`, `thesis-weakening` and `stale` are cross-market. `ceiling-close` is VN stocks only, short horizon only (a long segment masks it), fires on a close at or just under the ceiling (within `LIMIT_HIT_TOLERANCE_FRACTION` of the band, at the session's high) and only until the next open has passed, measured on `daily_bars` (the next open gaps up, the ten sessions after lag), sold at the operator's take-profit tranche, off at `VN_CEILING_TRIM_POLICY.sessions = 0`.
- On a long horizon `thesis-weakening` also needs the business factors (`BUSINESS_FACTOR_IDS`: quality only, read on its score because VN weighs it zero in the composite) read and bearish; value stays out (it reads the price paid). A market with no business factor sells on its composite alone.
- Where the market reads annual reports (VN, `FactorScore.businessWeakening`) the latest final report decides: Piotroski at or below `VN_ACCOUNTS_POLICY.weakAtScore` sells, above keeps; the quality lean is the fallback only where no final report could be scored, except `readingOnlySectors`, where the report prints and the quality lean decides. A year counts only after its audit window closes.
- Banks carry a books line (bad debt, watch list, cover, CASA) that informs and never sells. The accounts history (`markets/equity-vn/accounts/`: per-year figures, the newest quarters, trend over `VN_ACCOUNTS_POLICY.trendYears`, flags; read once per board day) prints on the quality line and reaches the debate (ANNUAL ACCOUNTS) and chat agent (`market_accounts`); it informs and never sells, gates or scores. On a buy the accounts score is a factor line only: add no buy gate from it. A developer's cash-timing flags stay silent.
- A standing evidence reduce or its `evidence-sold` / `sale-below-board-lot` hold closes the name to `/rebalance` (`EvidenceReduceReasonCode` is exactly the closing set; the plan's own reasons are excluded).
- The drift rule sells weakest first: an over-target segment takes the overshoot from neutral holdings (score between the weak-holding line and zero), lowest first, before any positive-scoring name; an excluded name and the core's floor are never cut. A holding whose weight passes its per-name (or fund) cap plus that cap's 5/25 band sells back to the cap whether or not its segment drifted. A sector past its cap plus band gives the excess back from its weakest names first, funds and zero-target segments excluded. Allocation reads the trimmed weights.

### Macro composite and shares

- A macro driver publishes its share of the vote actually cast: a series with no reading does not vote, the composite renormalizes, and partial data is reported via `coverage` and the missing list on every surface publishing the composite. The macro kind's targets are the drivers; a partial pass names absent ones in `missingTargets` for the repair pass.
- The snapshot is stamped with the settled session both it and its refresh share, never the calendar day; the region read deriving the composite dates it the same way.
- Published weights sum to one and contributions sum to the score, in rendered figures too. `apportion` owns every set of shares printed under their whole (macro drivers, factor contributions, the profile's segment targets, both segment tables in `/portfolio` and `/rebalance`); `WEIGHT_QUANTUM`, `SCORE_QUANTUM`, `FRACTION_QUANTUM` set each resolution.
- A segment's weight in its table and in the order lines above it comes from one apportionment; money beside order weights reads unrounded points. Apportion only rows that print a share.
- A factor composite divides by the fired total and publishes the quotient, not raw policy weights. A driver names its unit (rate = percentage; index = level against its base year).

### Ledger and book

- The ledger is truth. Positions are pure folds over rows, never stored balances, keyed `(instrument, venue)`; every reader indexing positions uses `buildPositionKey`.
- Cash is per venue and moves only via a `transfer` row (no net-deposit effect). Assets cannot move between venues.
- Rows are edited and deleted in place; the book is the fold over rows as they stand, so a correction re-bases every reading, past suggestions included. Every write validates the whole book as it will stand afterwards.
- A holding below its venue's smallest accepted order is residue, not a position, on every planning or acting surface (`/portfolio` lists it nowhere and counts it held back; `/suggest` builds no plan or cost line; `/rebalance` sizes nothing; `/reconcile` reports it only from the side the book does not claim). `isBelowMinimumSize` is the one comparison; callers are `isUntradeable` (book) and `isUnclaimedDust` (venue). `/brief` (loss count, held-name suggestions), `/market`, `portfolio_view` / `portfolio_review` / `order_exits`, the `/trade` open-trade cap and the markets `/refresh` keeps in use skip it too (`createTradeableBook` for holdings, `withoutResidue` for a valued book); its value still counts toward NAV.
- A sale may exceed the position it closes by a hair (exchange lot rounding over an in-kind fee; a whole-unit sale of a whole-unit holding closes at exactly its size): `closingOvershootOf` is what the validator admits and `isClosingSale` what the fold reads to release the whole basis. One-sided: a sale under the position by more than float residue is a partial; a too-small sliver is answered against the venue minimum, not a fold ratio.
- Recorded trade figures come from the venue when it can be asked: `features/ledger/fills.ts` matches the draft against that venue's fills for the day, side and instrument; exactly one within 1% of the stated size makes the row (quantity net of a fee billed in the delivered asset, average price, fee priced in the transaction currency). A stated fee is never overridden but does not suppress the ask. With no client, no single match or an unbookable fee the row stays as typed and the venue's `fees` prices an omitted fee; an unreachable venue logs `ledger.venue_fill_unavailable` and degrades the same way, never refusing the write. The confirmation names each figure's provenance (`FillSource`).
- `/record sync <venue>` enumerates every fill since the book's first row rather than matching a typed trade: idempotency key `<venue>:<orderId>` (`buildVenueFillKey`), the same key `/trade`'s mirror and the exit tick book under, so one fill has one row whichever writer lands first; a fill's market is resolved against the markets the venue holds only; a name the book could take only part of is taken not at all. Details: [docs/en/trading.md](docs/en/trading.md#surfaces-of-the-book).

### Personas, prompts and debate

- No persona states a level: the portfolio manager and market analyst carry "never propose an entry, stop, target, position size, or conviction"; thesis numbers are weights, drawdowns, rates and supply figures.
- A persona is handed its methods, never offered them: it carries no tools; skills for its role and market are prepended to its prompt (a request with no tool list is the shape providers enforce an output schema on). `skill_view` and `<available_skills>` stay for the chat agent and MCP hosts.
- A persona prompt has two halves and only one may vary. `RolePrompt.instructions` (playbook and rules shared by every call of that role on one market) rides the system prompt ahead of the volatile date block; `RolePrompt.message` carries this call's evidence. The run's `routingKey` (`<role>:<market>`) keeps those calls on one OpenRouter endpoint whose cache holds it. Anything per call (session line, price, claim, repair) goes in `message`.
- A persona declares the reasoning effort its task needs in its `agent.toml`: effort pays for building a case from evidence, not for restating a fixed plan, choosing among three verdicts or checking a claim against supplied evidence. `calculationVersions` hashes persona efforts with the skill set and debate mode, so an effort change separates populations as a skill edit does.
- A persona's reading of the tape is checked, never trusted. The trader's price condition carries a level (`above`/`below`, board scale); `toTradePlan` drops one the entry already meets and turns a wait with nothing to wait for into an entry with a stated reason. Every condition names its `kind`: a `timing` one never holds a wait, nor a `volume` one where the market sets `volumeGradesBreakout` (crypto); both print as advice. The trader is told the session an order placed now would trade in.
- A role waits only on what it reads: the claim verifier takes the synthesis's accepted ids and the researchers' claims, so it runs beside the trader and risk analyst; the pair is joined under one locally owned controller aborted in `finally`.
- The footer names the model from the rows it bills, on every surface, only where one model served every billed call (else only the count is true); a model switch is named directly above the footer on every surface, read off the bus. A network-waiting command declares `execution` (earns the progress line and footer); a local-state command declares neither.

### MCP serve (client model)

- Under `mcp serve` the client's model answers every model call (`Needs.modelSource: 'client'`). No served call waits over 45 s (it returns `working`; the client calls `model_resume`); every MCP run carries `audience: 'operator'`, which may see `units` and figures derived from `units` and public prices (order amount, stake, round-trip fee); a suggestion `report` never prints a holding's size, cost basis, realized return or own fill (`scripts/check-report-figures.ts`); `suggestion_run` and `brief_build` take `force` with no approval. Details: [docs/en/commands.md](docs/en/commands.md#mcp), [docs/en/dev/internals.md](docs/en/dev/internals.md#mcp).

### Costs, security and config

- Costs are tracked per run. `LLMUsageTotals.modelCalls` counts every attempt including failures (billed), over the same rows the cost and token sums fold, less `kind = 'external'` vendor fees.
- Daily/monthly/per-run caps with 80% soft-warn are opt-in (0 = uncapped). Loops are bounded (loop-detector, turn/duration caps).
- Agents talk to tools; tools talk to the database. Agents never touch storage.
- Memory rejects secrets and injection.
- Untrusted plugins contribute no code unless `plugins.allow_code`; tools and hooks stay forbidden regardless; a source module is the one code contribution that flag opens.
- Config is merged once at boot and frozen. Channel access is allow-listed/paired, fail-closed.

## Coding rules

### Naming and structure

- kebab-case files and folders; singular single-concept files (`tool.ts`), plural collections (`tools/`). camelCase functions, PascalCase types, one name per concept.
- One file per slash command, named for it. A feature owning one keeps `command.ts` (`order/command.ts` is `/trade`); owning several gets `command/` with one file each (`portfolio/command/{portfolio,rebalance,watchlist}.ts`). The folder appears with the second command, not before.
- Functions by default; classes only for stateful lifecycle (`this` across methods sharing mutable state). Plain frozen objects for reference data.
- `core/utils/` is class-free: stateful helpers are factories (`lruMap`, `ttlCache`, `withCooldown`) returning a plain object implementing an interface.
- Named exports only. `import type` for type-only imports (`verbatimModuleSyntax`).

### Limits

`biome.json` mirrors this table; change both together. Cohesion can justify an exception: document it, and for file size name the path in `scripts/known-exceptions.json`. Never widen a threshold (ratchet only).

| Metric | Target | Lint flag | Enforced by |
|---|---|---|---|
| Function body | <=40 code lines | >45 non-blank: warn (error in core/ai/persistence; `scripts/research-*` fixtures 50); >40 and unlisted in `scripts/known-long-functions.json`, or listed and grown: error | Biome `noExcessiveLinesPerFunction` + `skipBlankLines`, and `scripts/check-function-limits.ts` (ratchet: split a function rather than raise its number) |
| File | <=400 code lines | >400 non-blank: error | `scripts/check-line-limits.ts` (non-blank lines, so the blank-line paragraph style AGENTS.md requires is free) |
| Cognitive complexity | <=15 | >15: warn (error in core/ai/persistence) | Biome `noExcessiveCognitiveComplexity` |
| Params | <=3 (options object beyond) | >3: error | Biome `useMaxParams` |
| Nesting | <=3 | review only | none |

### Type safety

- `unknown` in catch. No `any` outside catch. No `as` or `x!`: narrow first; a surviving assertion carries a why-safe comment.
- `interface` for shapes, `type` for unions. Either-or data is a tagged union, exhaustiveness-checked with a `never` default. `satisfies` for literal registries (`as const satisfies`). Branded ids for interchangeable-looking primitives.
- Explicit return types on exported functions. `foo?: T` over `| undefined`.

### Async

- No floating promises: `await`, `return`, or attach `.then`/`.catch`/`.finally`. Promise arrays use `Promise.all`.
- `return await` inside a `try` with `catch`/`finally` (a bare `return promise` skips both).
- Anything that can outlive its caller accepts and propagates `AbortSignal`.

### Resource lifetime

Leaks are production incidents and review-blocking. For every acquired resource ask who releases it on the throw, abort and early-return paths; if the answer is not `finally` or `using`, it leaks.

- Every `setTimeout`/`setInterval` has a reachable `clear*`; whoever starts an interval owns stopping it.
- Every `addEventListener`/`bus.on`/`emitter.on` has a matching remove/`off`, or is armed with `{ signal }` / `{ once: true }`.
- Every handle (file, socket, DB connection, pool client, stream, lock) is released in `finally`. Happy-path-only cleanup is a leak.
- Every `new Promise` executor path settles. Abort must tear down (clear timers, detach listeners), not just reject. If a signal may already be aborted, check it before subscribing or arming; for early async exit prefer `return Promise.reject(err)` at the top over arming then rejecting.
- A serialization tail (`tail = tail.then(...)`) is replaced, never appended to a growing array. Retry chains and pending-request maps have removal paths on success, failure and timeout.
- Any `Map`/`Set`/array growing per request, run or session is bounded (LRU, TTL or eviction on completion); unbounded only for boot-time fixed-cardinality data.
- Per-run state never lives at module scope; it belongs to the Run or a factory closure.
- Cleanup (`close()`/`stop()`/`dispose()`) is idempotent and non-throwing, callable twice and after a failed start; a throw in cleanup must not mask the original error (log and continue).
- The function that opened a resource closes it; one that merely accepts it does not. Comment ownership when the signature does not say.

### Time and clock

- Read the clock once per logical operation and thread the value (no `Date.now()` per row or in a loop).
- Epoch-ms integers at every persistence and wire boundary; never a native date type in a column or a `Date` in a stored payload.
- Two-tier fields: epoch-ms `number` for machine instants (`startedAt`, `createdAt`, `firedAt`; INTEGER/BIGINT); `YYYY-MM-DD` day strings for trading calendar dates (`asOf`, candle/ledger/suggestion `at`; TEXT). Never compare a datetime string with a day string; compared fields (`LedgerTxn.at`/`settledAt` vs `Book.asOf`) are day strings, intraday order comes from ledger append order.
- Durations are `*Ms`, from config or an `UPPER_SNAKE` constant; no bare literals in `setTimeout`.
- Measure elapsed time with `performance.now()`, never wall-clock differences.

### Control flow and errors

- Guard-clause early returns. No boolean params for branching (options object or two functions).
- Throw only typed `Error` subclasses from the hierarchy (`RunHalted`, domain `*Error` carrying a `code`; `src/core/errors.ts`). Never raw `throw new Error()`. An empty catch needs a comment.
- A setup failure the operator can fix (a config value, a path, a key, a cron field) throws `OperatorConfigError` with a keyed `errors.*` message, so it reads in `[locale]`; a schema failure goes through `toInvalidConfigError` (both via `@/core/config/resolve`). A bare `ConfigError` is internal: surfaces print a generic localized line and keep its English for `--verbose`.

### Modules and exports

- Minimize exports. No `export let`. An unused export is a bug: wire every export to a caller (`scripts/check-unused-exports.ts`), path helpers included.
- Sanctioned barrels, the only barrel files: the SDK `src/index.ts`, each module's `api.ts`, a market's `api.ts`. Everything else imports directly via `@/*`. `noBarrelFile` is waived for exactly those paths in `biome.json`; widen that list only alongside the rule it serves.

### Import paths

Cited by `scripts/check-imports.ts`.
- No file extensions in specifiers: `@/core/errors`, never `@/core/errors.ts`.
- Prefer the `@/*` alias over deep relative chains (`../../`); `./sibling` is fine; bare specifiers (`zod`, `node:crypto`) unchanged.
- `import type` for type-only imports. Biome's import grouping (node/bun, packages, `@/**`, relative) is load-bearing; do not hand-reorder.

### Comments, constants and branding

- Comment only where logic is non-obvious or a quirk's why must be kept. Never task or plan numbers, narration, or restated code.
- No hardcoded values: tunables from config (defaults applied once at resolve); fixed constants `UPPER_SNAKE` at module top. Repeated or meaning-bearing literals get a name; single-use obvious ones (index math, the `4` in a dotted quad) stay inline.
- The string `openalpha` appears only in `./package.json` (`productName`); `core/brand.ts` derives everything and freezes it. Never write the literal (any case) in `src/`; use `BRAND` from `@/core/brand` (`BRAND.name` slug, `.display` `OpenAlpha`, `.dataDirName` `.openalpha`, `.envPrefix` `OPENALPHA_`, `.pidFile`).
- That covers every derived identifier (file names, config/data dirs, env prefixes, PID files, log paths, HTTP `User-Agent`, CLI usage, channel banners). `BRAND` derives from `productName`, not the package name. User-facing strings naming the CLI go through i18n with `{brand}` injected. Gate: `grep -rniE 'openalpha' src --include='*.ts' | grep -v '@openalpha/'` returns only `core/brand.ts`.
- Any other single-source identity value (version, repo URL) gets one source, derived everywhere.

### Simplicity and consistency

- Nothing hard to understand: no clever one-liners, nested ternaries or implicit coupling; restructure or add a why-comment.
- No duplication: an expression, guard or dispatch appearing twice becomes one named helper or constant; near-identical functions merge.
- Verify logic, not just shape: after a refactor re-derive each touched function's edge cases (empty, boundary, malformed input, every return path); call out intentional behavior changes, never make them silently.
- One verb owns each contract; a synonym claims a different one. A step named by its pipeline keeps that name.

| Verb | Contract | Returns |
|---|---|---|
| `is*` / `has*` / `can*` | pure predicate | `boolean` (or `x is T`) |
| `assert*` | throws when the condition fails | `void` |
| `validate*` | collects problems without throwing | issue list |
| `to*` | converts a value to another type | new type |
| `parse*` | builds a value from a string | parsed type, or throws |
| `resolve*` | derives a value from config/context | resolved value |
| `create*` | factory returning an object with behavior | the object |
| `build*` | builds a plain value (URL, SQL, diff) | the value |

- Do not use `check` (`assert*` owns "throws"), `verify`, `vet`, `convert` (use `to*`), `make`, `new`.
- A function returning the offending items is a noun phrase, not `has*` (`duplicateQuestions`, `unresolvedCoverageIds`).
- A function that both reports to the user and returns a verdict is two concerns: expose the pure predicate, print at the call site.

### Paths

| File | Owns |
|---|---|
| `core/config/paths.ts` | Where configured data lives (pure sync string math): `expandHome`, `resolveDataDir`, `resolveConfigFile`, `resolveDataRelative`, `resolveSqliteDatabasePath`. Internal; use the `config/resolve` facade |
| `core/logging/paths.ts` | Agent log locations and segment files: `isLogSegmentName`, `resolveAgentLogFile`, `resolveAgentLogsDir`; sole owner of `AGENT_LOG_SEGMENTS` / `AGENT_LOG_FILE_NAME`. Public |
| `core/security/agent-directories.ts` | Creating private scratch/log dirs without a symlink race (`prepareAgentScratchDir`, `prepareAgentLogFile`; TOCTOU defense over `security/private-files` and `security/path-policy`). Public |

- `expandHome` expands only `~` and `~/...`.
- Configured paths use `resolveDataRelative(path, dataDir)` (`~/` to home, absolute as-is, relative joins `dataDir`); no bare `expandHome` in `resolve.ts` for `[log] file`.
- A path that may start with `~` (`--config ~/foo.toml`) runs `expandHome` before `isAbsolute` / `join(cwd, ...)`.

### File structure and declaration order

A file reads top to bottom: imports, module constants, types, functions.

- Imports first, grouped (node/bun, packages, `@/**`, relative; `import type` sorts within groups), one blank line before code; never interleave imports with logic.
- Module `UPPER_SNAKE` constants go right after imports, even single-use ones. Exception: a type derived from a constant (`typeof X`) or a constant typed by an interface (`as const satisfies`) stays adjacent to its dependency.
- A constant's initializer references only imports, literals and declarations above it, never a function defined lower.
- Types live in a colocated `types.ts` per module, or inline when one file uses them; do not grow one central types barrel. A type used by two or more functions goes in the top block; a type used by one sits directly above that function.
- Interface placement follows ownership:
  - Role interface (consumer defines, another module implements: `PairingStore`, `FtsSearch`, `SlashCommand`, `ServiceProvider`): in the consumer's `types.ts`; the implementer imports it.
  - Header interface (only names what one same-file factory returns: `Pricing`, `TokenFile`, `ProviderChainRegistry`): directly above that factory, even if many files import it.
  - Module `types.ts`: shapes with no single owning factory or consumer (`ChainEntry`, `Transport`, `ModelPrice`).
- Functions last, ordered caller then callee (not alphabetical). A single-caller helper sits directly below its caller; a shared helper sinks below all callers.
- One blank between top-level declarations and between import groups; `bun run lint` collapses doubles.
- Biome does not enforce types-before-functions, caller-to-callee order or blank-line paragraphs; review them by hand.

### Formatting and readability (blank lines)

Treat code like prose: blank lines show structure, used semantically.

- One blank line separates logical steps (setup, execution, return). Test: does the next line start a new micro-operation? Populating one struct, validating one value, or one call plus its unpack stay tight; recording to deciding, deciding to acting, acting to returning each take a blank.
- Adjacent `if`s: a dispatch (each arm tests a different predicate and returns a different value) takes a blank between arms; a validation pass (several checks on one value) stays tight.
- No blank between tightly related lines: members of one object being populated, consecutive related calls, back-to-back reject-guards, arm sequences like `bus.on(...)` then `signal.addEventListener('abort', off)`.
- Consecutive `const`/`let` are one block, no blanks inside; one blank after it before the next step (including before a following `if`, e.g. `const m = re.exec(s)` / blank / `if (m !== null)`).
- No extra blank before a `return` that is the step itself. A loop's prologue and epilogue attach to the loop.
- Declare variables close to first use. Do not over-segment: a short function that reads as one thought stays unbroken. No numeric blank-line ratio target exists; the only backstop is a file over about 25% blank lines.

### Operator argument grammar

A scope narrowing a name is written `scope:ticker`, one token. `kernel/surface/surface.ts` owns the split and is the only file knowing the qualifier: `parseTickerRequest` (market half, against the registry), `parseVenueTickerRequest` (venue half), `parseQualifiedInstrument` (market required for a ledger row). A parser never infers a slot from argument count. `/record` and `/update` take an optional leading venue word before `market:ticker`: the one sanctioned exception, because the `scope:` slot is already the market.

| Shape | Where | Why |
|---|---|---|
| named field | every MCP tool input | JSON has named keys; `instrumentQueryInput` is the one ticker-and-optional-market pair |
| `scope:ticker`, optional | `/price`, `/suggest`, `/alert`, `/watchlist`, `/rebalance`, `/trade` | disambiguates a name inside a variadic or labelled line |
| `scope:ticker`, required | `instrumentInputOf` | a tool write states the market it books against |
| `scope:ticker`, optional, stored lists only | `/record`, `/update` | a write may drop the market only when the lists already stored, among markets a venue holds, name exactly one; no network lookup; the confirmation names the market. `/update` fills nothing else |
| bare token, order-free | `/screen`, `/refresh`, `market_sentiment`, `sector_strength` | the market is the subject; no ticker to collide with |

Markets and venues share `SLUG_RE`; `assertDistinctScopeNames` refuses, at composition, a venue id that also names a market. `/screen crypto` resolves market-before-kind by declaration order.

### Display and formatting

One owner per unit, enforced by `scripts/check-display-contract.ts` (reads call sites).

- Every rendered value goes through `trading/render/{format,datetime,money}.ts`. `format.ts` owns the unit; `render/number.ts` (called only by `format.ts`) owns the `Intl` option per unit. A surface never calls `Intl`, interpolates a raw value into copy, or hand-writes a separator, indent or glyph.
- Copy comes from `t(locale, key, params)` for `[locale] language`; the clock from `[locale] timezone` (`TradingConfig.displayTimezone`, default: the host's zone), threaded as a parameter. Never `toLocaleString()` without a locale, a hardcoded timezone, or a user-facing string outside the catalogs (`src/i18n/locales/{en,vi}.json`, every key in both).
- `en` resolves to `en-GB` for date order only (`DATE_ORDER_LOCALES`); both read day-first. `scripts/check-vi-terminology.ts` gates Vietnamese terms (`reduce` is *giảm bớt*, never *bán*).

Dates and numbers:
- `formatDay` (`@/i18n`, UTC-pinned calendar day; error messages pass `{ day }`), `formatClock` (configured zone), `formatInstant` (both), `formatPublishedDay` (citation epoch). A trading day is stamped by the session that produced it; every clock reads in the operator's one zone. The block states the session once; a section restates it only for a genuinely different instant.
- Magnitudes: `formatAmount`, `formatQuantity` (8dp), `formatCount`, `formatFlow`/`formatSignedFlow` (compact long, 3 significant digits), `formatRatio`/`formatMultiple`, `formatScoreValue` (forced sign), `formatSpendUsd`.
- `*Pct` does not tell the unit. Fractions (`0.1425`) use `formatFraction`/`formatFixedFraction`/`formatSignedFraction`; percent-valued fields (`12.5`) use `formatPercent`/`formatSignedPercent`/`formatSignedFixedPercent`. The wrong family is off by 100x; document the unit on the field when unclear.
- Caveats and findings carry the raw fraction; the catalog writes no `%` (`SUBJECT_FRACTIONS` in `render/subject.ts` lists share fields; `renderSubject` stamps the unit; `check-caveat-details` fails `%` after a placeholder). A gap that rounds away is not stated (`isReportableGap`).
- Fixed decimals wherever rows stack (`*Fixed*` forms). `formatPrice` is fixed (`boardPrice` for board prices, else `formatFixedAmount`); `formatWholeFraction` for folds over weights; a rank is `formatPercentRank` (`tốt hơn 85%`), never `p85` or a percent.
- A value that rounds away carries no sign (`formatNumber` yields unsigned zero). `hasMagnitude` owns that question and every direction mark asks it, not the raw value (`scoreBar` too). Money uses `formatFixedDigits`. A non-finite value prints `ABSENT_CELL`. Glyphs come from `withGlyph` (arrow and sign: `▲ 1,31%`, `▼ -0,49%`), judged off the rendered text.
- Absent is not zero. Lists are bounded (`MAXIMUM_NAMES_PER_LIST`).

Prices and quotes:
- `formatQuotedPrice` is the only price renderer. A board-scaled market (`PriceDisplay.divisor > 1`) prints no currency; the scale is noted once per message. A price prints at its own currency's precision (`formatFixedPrice`); `RowUnit` carries decimals and code-naming apart. Aggregate money takes the section currency; a price never does.
- An index publishes a level, not a price: `isLevelKind` (index futures too) carries no board scale or currency, `QuoteView` leaves `unit`, `currency`, `display` absent together, and a level takes no currency even in a section that has one. `MarketDataOverview.priceCurrency` differs from `currency` and is absent for level markets; never label VN-Index from `currency`.
- A dealer board states no last trade: `Quote.board` carries both sides and the gap; surfaces print those cells, not a price pair. A plan trades against the side it fills (buy at `sellPrice`, sale at `buyPrice`; a buy's stop and target on `buyPrice` via `LevelRequest.exitPrice`). Exit watches and the book's valuation read that side through `exitPriceOf`; a `gold-shop` fill is moved onto the buy side by its spread in `recorded.ts`. Never place a level on one side and watch or value it on the other.
- Never blend readings: show the settled close and the live price as separate dated rows (`PricePair`); live is absent when the market has not printed.
- A close is dated by its own session (`closedOn`), never the block's `asOf`; a close with no session is dropped. `changeAgainstClose` owns the move; a provider's `changePct` is a rolling window on continuous markets, never taken verbatim.
- Freshness is decided by the reading's session, not its instant: `isLiveObservation` compares `dayAt(observedAt)` to `resolveSettledDay` and checks age; `toLiveReading` applies the same age test. The market's quote capability enforces it, never the adapter. A failing reading drops to the stored close through `liveOrStoredQuote` (the one owner); a provider quote survives only for a name the store cannot price.
- Staleness uses the region's last settled session (`resolveRegionSettledDay` in `features/portfolio/folds/staleness.ts`), never the book's `asOf`. Providers never decide it, and a bars window's `toDay` is never re-derived from the exchange calendar.
- A tally over rows reads `liveMoveOf` (say `live`, not `priced`); a one-reading-per-line surface asks `quoteBoardMoveOf`. `settledCloseBefore` returns the close the reading stands on; do not measure `last` against `previousClose.price`.

Windows, movers and layout:
- A window label says where it ends: `year-high` includes the latest close; `breakout-trigger` and `trailing-low` use prior sessions (Turtle) and say so. A window is part of the label (`(20 phiên)`).
- Mover lists carry the window in their kind (`MOVER_KIND`: `movers-session` or `movers-24h`); the traded-value ranking uses `LEADER_KIND` and `MarketLeaders.sessions` is absent on a rolling window. A settled-session reading carries its own session where its block does not (`MarketTakerFlow`).
- Width comes from `RenderContext` (`resolveRenderContext`: terminal 90, phone 45); `toFactLines` joins as many facts as fit; one fact never splits.
- The trading surface writes markdown; the destination decides: Telegram converts to MarkdownV2 (`channels/adapters/telegram/markup.ts`), Zalo strips at send, the CLI strips at its one print site. No renderer carries a markup flag.
- A fold hides detail, never a decision (`toFoldLines`): never a stop, target, size, warning or refusal reason inside one. Every button is a command the reader could type (`Affordance` = label + slash command; a tap re-enters the normal admission path).
- `render/layout.ts` is the only file that builds `INLINE_SEPARATOR` (` · `) and `INDENT[0..3]`. The `━━━` rule marks which market a run of rows belongs to (`/brief`, `/overview`, multi-market ticker lists); one market needs none.
- Say each fact once. Ready sections' caveats hoist to one list per message; only a failed section states its own. `renderCaveatLines` dedupes on the rendered sentence, not the code.
- A progress line leads with its subject and a fanned-out count states its unit (`72/728 mã`); `/refresh` lines lead with the market, built once in `kernel/market/refresh.ts`. The subject travels as a nested keyed message (`{ market: { key: 'trading.market.crypto' } }`) resolved per surface locale; a deep reporter holds no `Locale`.
- Label only what needs one (tickers, sectors, headlines and signed percents name themselves); continuation rows are labelled. Ledger write confirmations label every field (`ledger/fields.ts`); the history row does not.

### Logging

Enforced by `scripts/check-log-keys.ts`.
- One key, one call site; the dotted key names a failure boundary. Arms of one operation may share a key when their fields distinguish them (record in `SHARED_KEYS`).
- Log where the failure is handled, only there. A site that logs and rethrows owns the name; the catcher does not reuse it. A specific key plus a terminal one (`migration.failed` then `boot.failed`) is correct.
- Levels: `fatal` process cannot continue (entry boundary, once); `error` the requested operation failed; `warn` degraded but handled; `info` lifecycle, bounded by process lifetime; `debug` rate scales with traffic.
- Fields are camelCase and stable. The error payload is `err: formatErrForLog(err)` (scrubbed `type`, `code`, `message`, `stack`), never `error`/`e`/`exception`.
- A per-record or per-chunk failure logs once (first reported, closure suppresses the rest; `AGENT_LOG_DROP_POLICY`).
- No `console.*` outside `cli/`; log through the injected logger (it scrubs).

### Performance

The LLM call (1-30 s) is the only real bottleneck.
- All I/O async; sync fs only at boot. Stream LLM responses, never buffer. Pre-compile regex, Zod and hooks at boot. Push `WHERE`/`LIMIT` into SQL; never fetch-all-then-filter.
- Where a router serves one model from many endpoints the endpoint dominates latency: `[[models]] provider_sort` states a preference; absent leaves the choice to the router.

## Testing

There are no test files. Do not run `bun test`: it verifies nothing.

- Verification is `bun run typecheck` + `bun run lint` + `bun run check` (+ `bun run lint:arch` for trading changes), plus walking the affected business invariants with a one-command manual check against live data.

## Working principles

1. Think before coding. State assumptions; if several interpretations exist, present them rather than picking silently; push back when warranted.
2. Simplicity first. Minimize concepts and ownership paths, not merely line count. Nothing speculative; no abstraction for one concrete use. Self-check: does this remove more complexity than it adds?
3. Unify before adding. Find the existing owner, interface, registry, renderer, limiter or lifecycle before creating one. Same policy: extend that path. Different policy: keep it explicitly separate.
4. Surgical changes. Every changed line traces to the ask. No drive-by refactors. Clean up branches and orphans your change created; mention pre-existing dead code, do not remove it unasked.
5. Goal-driven. Turn vague asks into verifiable outcomes and name the invariant, owner, success signal and failure behavior before starting.

## Before-finish checklist

- [ ] Baseline recorded (typecheck exit); pre-existing failures noted, not silently fixed
- [ ] Typecheck clean against baseline: `bun run typecheck`
- [ ] Lint clean: `bun run lint`
- [ ] Touched files hand-checked for formatting and readability (blank-line paragraphs, types-before-functions, caller-to-callee); Biome does not enforce these
- [ ] The change's business invariants manually verified (there is no `bun test` suite; see Testing)
- [ ] No new `console.*` outside `cli/`; logging via the injected logger (it scrubs)
- [ ] Rendered values go through `render/{format,datetime,money}.ts` and copy through `t(locale, ...)`; no raw `Intl`, hardcoded timezone, or user-facing string outside the catalogs (see Display and formatting)
- [ ] No new `process.env.X` outside config/boot/cli entry
- [ ] Every changed line traces to the request; no orphans left behind
- [ ] A user-visible change updates its guide in `docs/en/` and `docs/`; a contract or internals change updates its page in `docs/en/dev/` and `docs/dev/`. Guides carry no code or `src/` links; name things rather than count them
- [ ] Subagent reports verified against the actual diff

## Subagent dispatch

Briefs must include: goal, file list, do-not-touch list, a path-scoped verification command (never bare `bun test`), and the report format. Verify the report against the diff.
