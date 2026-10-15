# OpenAlpha for developers

These pages are for people changing OpenAlpha or building on it. Running it as an operator? The
[guides](../README.md) are all you need. The house rules for code - layers, gates, style - are in
[AGENTS.md](../../../AGENTS.md) and [CONTRIBUTING.en.md](../../../CONTRIBUTING.en.md).

| Page | What is in it |
|---|---|
| [internals.md](internals.md) | Architecture decisions, the feature inventory, display contracts, MCP |
| [extending.md](extending.md) | The SDK surface, embedding the runtime, the app container, plugins |
| [data-sources.md](data-sources.md) | The source contract, adapters, registration, routing, errors, cache |
| [trading.md](trading.md) | Contracts behind suggestions, alerts, the book, venues and the HTTP API |
| [agents.md](agents.md) | The agent loader, delegation, skills, the model chain, retries, caching |
| [budgets.md](budgets.md) | Cost admission, settlement and how a budget is sliced across a run tree |
| [channels.md](channels.md) | The channel definition, the adapter contract, adding a channel |
| [safety.md](safety.md) | The approval gate and the error hierarchy |
| [storage.md](storage.md) | Dialects, migrations, the table registry, the session store |
| [operations.md](operations.md) | Daemon loops, the job scheduler, the heartbeat protocol |
| [research.md](research.md) | How a research run is built and how evidence is admitted |

## Where things live

Pointers that have no page of their own:

- Config: schema in [core/config/schema.ts](../../../src/core/config/schema.ts), defaults in
  [core/config/resolve.ts](../../../src/core/config/resolve.ts) and the resolvers beside it.
- Provider and model catalog: [ai/catalog.ts](../../../src/ai/catalog.ts).
- CLI commands: [cli/registry.ts](../../../src/cli/registry.ts) (`api` and `setup` are added by the API server).
- Trading chat commands: each feature keeps its own in `features/<name>/command.ts`, registered in
  [trading/wiring/catalog/commands.ts](../../../src/trading/wiring/catalog/commands.ts). Trading registers
  its commands, tools and agents at boot, so a bad market, venue or region name, or a missing locale
  key, fails boot rather than a run.
- Screening per market: [equity-vn/screen.ts](../../../src/trading/markets/equity-vn/screen.ts),
  [crypto/screen.ts](../../../src/trading/markets/crypto/screen.ts).
- Market regime: [markets/macro-risk.ts](../../../src/trading/markets/macro-risk.ts) (shared formula),
  [equity-vn/evidence/macro.ts](../../../src/trading/markets/equity-vn/evidence/macro.ts) (VN overlay).
- Suggestion pipeline: [features/suggestion/pipeline/](../../../src/trading/features/suggestion/pipeline/).
- Morning brief: [equity-vn/brief/](../../../src/trading/markets/equity-vn/brief/).
- Ledger and portfolio: [features/ledger/](../../../src/trading/features/ledger/),
  [features/portfolio/](../../../src/trading/features/portfolio/); rebalance advice and allocation in
  [portfolio/folds/](../../../src/trading/features/portfolio/folds/).
- Alerts, exits and unusual moves: [features/alerts/](../../../src/trading/features/alerts/).
