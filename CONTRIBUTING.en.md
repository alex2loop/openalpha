# Contributing

[🇻🇳 Tiếng Việt](CONTRIBUTING.md) &bull; 🇬🇧 English

Thanks for looking. This is a single-operator open-source tool, so the bar is
less "matches the house style" and more "will still be right in six months".

## Before you start

**Open an issue first for anything structural.** A new market, a new venue, a new data
source, a change to the suggestion pipeline, or anything touching the order path. These
were designed on purpose, so the design is what gets reviewed, not the diff. Small fixes
and documentation do not need one.

**There is no test suite.** That is deliberate, and it means the gates are the
contract. Both must be green:

```bash
bun run check      # biome + typecheck + 16 contract gates
bun run lint:arch  # 16 architecture gates
```

They are fast and they fail with the offending line. Together they catch a cyclic
import, a widened kernel API, a market reaching into a sibling, a rendered number that
skipped the display contract, a log key used twice, a missing locale string, a file over
400 lines, an export with no consumer, and a file no entry point can reach.

**Verify behaviour with a live run**, because the gates only prove structure. A change to
a market means running `/suggest` or `/screen` against it and reading the output.

## Setup

```bash
git clone https://github.com/alex2loop/openalpha.git && cd openalpha
bun install
cp config.sample.toml config.toml   # fill in one provider key
bun run dev -- doctor
```

Bun 1.3 or newer. No database to install.

## The rules that matter

[AGENTS.md](AGENTS.md) is the full rulebook — architecture, module boundaries, the
business invariants, and the coding conventions. It is long because most of it is the
reasoning behind each rule. You do not need to read all of it to fix a
typo; you do need the relevant section before changing a subsystem.

The short version:

- **Modules are acyclic and point toward the kernel.** A module's public API is its
  `api.ts` and nothing deeper. `core` stays free of finance vocabulary.
- **Errors are typed.** Never `throw new Error()`; use the hierarchy.
- **No user-facing string outside the locale catalogs**, and both `en` and `vi` must
  carry every key. A missing key makes startup fail and list exactly what is missing. Vietnamese
  terminology is gated by `scripts/check-vi-terminology.ts` (in `lint:arch`): `reduce` is
  *giảm bớt*, never *bán*.
- **Every rendered value goes through the display contract** in `trading/render/`. A
  price, a percent and a count each have one place that formats them, and the gate checks every call site.
- **No `any` outside `catch`, no `as` casts, no `!`.** Narrow instead.
- **Read the clock once per logical operation** and thread the value.
- **Every timer, listener and handle has a matching cleanup** on the throw path, the
  abort path and the early-return path. Leaks are treated as defects, not style.

## Extending it

Adding any of these is a local change that touches nothing else. Each is documented in full in AGENTS.md:

- **A market** — a folder under `trading/markets/<ref>/`, its factor ids, one
  `markets.register(...)` line, its sources, and its locale keys in both catalogs.
- **A venue** — a folder under `trading/venues/<id>/`, one `venues.register(...)` line,
  and one locale key in both catalogs.
- **A data source** — an adapter under `trading/sources/adapters/`, a route in
  `SOURCE_ROUTES`, and a registration. Endpoints and rate limits live in code by
  design, so no configuration can redirect a request.
- **A plugin source** — a `sources.ts` at your plugin root. No fork needed, but it
  requires the operator to set `plugins.allow_code`.

Startup fails and names exactly what is missing, so a half-registered market or
venue cannot reach a surface.

## Pull requests

- **One concern per PR.** No drive-by refactors — clean up what your change orphans, and
  mention pre-existing problems rather than fixing them in the same diff.
- **Conventional commits**: `feat:`, `fix:`, `docs:`, `chore:`. The subject line says what
  changed for a user, not which files moved.
- **Say what you verified.** Which gates, and which live command you ran.
- **Call out behaviour changes explicitly.** A silent change to how a level, a size or a
  cap is computed is the one thing review cannot catch by reading a diff.

## Things that will be turned down

Not to be discouraging — these are settled decisions, and the reasoning is in AGENTS.md:

- **Auto-execution, or any second path to an exchange.** Human-in-the-loop is the product.
- **A backtest harness.** Forward track-record calibration only; `/reflect` is the answer.
- **Speculative abstraction.** No indirection, cache or framework without a measured need
  and two concrete consumers.
- **Widening a gate to land a change.** The thresholds ratchet in one direction. If your
  file is over the line, split it.
- **Config that can redirect a network request.** Endpoints stay in code.

## Reporting a bug

Open an issue with the command you ran, what you expected, and what you got. Include the
market, since behaviour is market-specific in more places than you would guess.

For anything with security impact, use [SECURITY.en.md](SECURITY.en.md) instead — not an issue.
