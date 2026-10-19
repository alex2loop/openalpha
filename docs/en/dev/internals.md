# Internals

For developers changing OpenAlpha: why the code is shaped this way, what the runtime contains, and what
every surface must do when it presents a result. Using it instead? Start at the [docs index](../README.md).

---

## Architecture decisions

[AGENTS.md](../../../AGENTS.md) is the authoritative rulebook and `scripts/check-dag.ts` is the
module-boundary check you can run. If the two disagree, the check wins. Every decision below is in force.

### AD-1: One acyclic runtime DAG

Every dependency points toward `core`. `app` is the only composition root.

```text
core        -> nothing
i18n        -> nothing
ai          -> core
engine      -> core, ai
tools       -> core, engine
persistence -> core
memory      -> core
scheduler   -> core, engine
commands    -> core, engine, scheduler
plugins     -> core, engine
social      -> core, engine, i18n
trading     -> core, engine, persistence, i18n
channels    -> core, engine, commands, i18n
cli         -> every runtime module except app
app         -> all runtime modules
```

The HTTP/WS API lives inside `app` ([src/app/server/](../../../src/app/server/)): routes, wire contract,
mappers and the socket. It reaches trading only through the trading host
([src/trading/wiring/host/](../../../src/trading/wiring/host/)).

*Why:* cycles hide ownership. A checked DAG keeps dependencies reviewable and business modules
independent of delivery surfaces.

### AD-2: Public module APIs are explicit

Cross-module imports use `@/<module>/api`. Three exceptions:

- `core` has no barrel. Its public files are listed in `CORE_PUBLIC` in `scripts/check-dag.ts` and
  imported directly. Adding a file there is the reviewable act that widens the kernel.
- `i18n` is a leaf with one entry, `@/i18n`.
- The package SDK barrel is [src/index.ts](../../../src/index.ts).

No module uses `export *`.

*Why:* named surfaces prevent accidental coupling and avoid loading unrelated kernel dependencies.

### AD-3: Interfaces belong to consumers

A module that needs a replaceable service owns the smallest interface it uses. Providers implement it;
`app` binds the implementation. Modules that always ship together may depend on each other directly.

- `memory` consumes `FtsSearch` without depending on persistence.
- `channels` consumes `ChatBindingStore` without importing persistence.
- Tools, scheduler, commands, plugins, social and channels depend on engine directly.

*Why:* consumer-owned seams cut along real independence boundaries without speculative abstractions.

### AD-4: Run state is owned by the run

There is no `RunContext` service bag. A run owns its mutable state and receives services explicitly.
Per-run state never lives at module scope. The loop is bounded by turn, duration, loop-detection,
delegation, output-byte and cost limits. Anything that can outlive its caller takes and propagates an
`AbortSignal`.

*Why:* concurrent runs cannot corrupt shared state, and cleanup paths stay visible.

### AD-5: Trading is one bounded context

`trading` owns markets, data-source contracts, stages, suggestions, portfolio folds, its own locale keys
and its persistence contracts. No domain module imports it; only `app`, `cli` and the SDK may use its
public API.

It registers at provider step 9: after `commands` (whose registry it extends) and before `plugins` (which
must never see a mutable registry). It is not a plugin. Registration builds the market, source, stage and
venue registries, closes them, and runs a consistency check before the first binding.

Three things fail composition instead of failing at first use:

- a config value naming an unregistered market, region or venue (including a default venue that does not
  hold its market);
- a venue claiming a market nobody built;
- a code key missing from either locale catalog.

The SDK exports trading **contracts and results**, never registries, stores, adapters, markets, sources,
stages or operation factories.

*Why:* market and portfolio language stays out of the kernel, and every trading invariant has one owner.

### AD-6: The ledger is the portfolio truth

Positions are pure folds over ledger rows. No stored balance or mutable position snapshot may become a
second source of truth. Calendar fields are ISO day strings; entry ids are UUIDv7 and give intraday
order. Every write validates the whole book as it will stand afterwards, since an edit can invalidate a
row it never touched.

Rows are edited and deleted in place, so a mistyped date is fixed like any field. The accepted cost: the
book has no audit trail, and past suggestions cite the book rather than a snapshot of it, so an edit
re-bases them. `/reflect` reports a track record the operator can change retroactively.

*Why:* one derivation path makes accounting reproducible.

### AD-7: The product suggests; one narrow, human-approved order path

Trading tools research, score, size, debate, persist suggestions and read the operator ledger.
[src/trading/features/order/](../../../src/trading/features/order/) holds the one order path, behind
`/trade` and `order_place`, speaking to whichever venue has a `SpotAdapter` registered (OKX and Binance).
The invariant names the seam, not the exchange.

- Every order routes to exactly one venue and is refused when several could fill it, so a new exchange
  adds an implementation, not a branch.
- Caps are checked before a human is asked. The tool declines a remembered approval, so one decision
  never covers the next.
- Every fill is mirrored through the same `portfolio.record` path a manual `/record` uses.
- An approved entry may leave a resting take-profit/stop-loss at the exchange, which can fill after the
  run ends. No code chooses its levels or its moment, and a bounded daemon loop reconciles the fill into
  the ledger.
- With no exchange credentials, the venue is still registered as a custodian the operator records
  against, but it has no client. `order_place` is not registered and `/trade` only names the keys to set.
- Binance cannot move a resting exit. It declares `amend: false` instead of emulating a move with
  cancel-then-place, whose second failure would leave a position unprotected. `/trade exit` there is
  refused and names `/trade cancel`, so removing protection stays a deliberate step.

*Why:* human-in-the-loop is a structural boundary, not a prompt convention.

### AD-8: Plugins are data-first and trust is structural

Discovery and merging stay generic. Trusted built-ins may contribute executable tools and hooks.
Untrusted filesystem plugins are limited to validated declarative contributions; executable ones are
forbidden, not just ignored at run time. Registry collisions are rejected or skipped by the canonical
merge path; plugins never silently override built-ins. See [Extending](./extending.md#plugins).

*Why:* trust-sensitive code must be impossible to contribute through an untrusted shape.

### AD-9: Surfaces render; domains return structured results

CLI and channels own localization, formatting, terminal behavior and transport capabilities. Domains
return structured values and typed failures. Surfaces never import `app`. The engine resolves tool
display metadata once into stream events, and surfaces use that event instead of reading raw tool
arguments.

*Why:* policy is shared once while each surface controls its own presentation.

### AD-10: Configuration is resolved once at boot

Config layers are parsed, validated, merged and frozen before providers start. Runtime modules consume
`ResolvedConfig`; they do not read environment variables or reapply defaults. Provider order in
[src/app/providers.ts](../../../src/app/providers.ts) is fixed; do not reorder it without rechecking its
documented constraints.

Web search is optional, so a `[web_search]` key variable that is named but empty does not fail config.
`ResolvedWebSearch` carries it as `missingEnv` (primary) or `fallbackMissingEnv` (the fallback,
which is dropped). `defaultSearchProvider` in `src/tools/web/retrieval-request.ts` is the one refusal:
every search and contents call takes the primary through it, so none falls back to a keyless
provider. `doctor`, `config validate` and the `start` summary read the same field through
`toMissingSearchKeyError`; boot logs `web_search.key_missing` and `web_search.fallback_key_missing`.

*Why:* one boot-time owner prevents config drift and order-dependent behavior.

### Verification

```bash
bun scripts/check-dag.ts
```

It checks the allowed module edges, public API imports, the listed core surface, and the entry points of
the `engine/research` bounded context.

---

## What the runtime contains

Implemented and reachable behavior only. A design target is not a feature. Where another page owns the
detail, this section links to it.

**Chat and sessions.** `chat` runs a streaming one-shot message or an interactive REPL. Sessions persist,
run one task at a time, keep a bounded and compacted context, and have stale tool messages repaired
before the next model call. The engine checks citations, extracts explicit durable preferences, passes
cancellation down, and reports a typed terminal reason. Config and registries freeze at boot.

**Agents and teams.** Built-in agents: `chat`, `deep-researcher` with its internal workers
(`research-crawler`, `research-planner`, `research-reviewer`, `research-synthesizer`), and `reviewer`.
Trading adds the debate personas (`bull-researcher`, `bear-researcher`, `portfolio-manager`, `trader`,
`risk-analyst`, `claim-verifier`, `market-analyst`), scheduled by the suggestion pipeline and not
user-selectable, plus `theme-analyst`, run by `/themes`. User and plugin agents cannot replace protected
ids.

A [team](../agents.md#teams-and-delegation) is derived from config: an orchestrator with a `delegates`
roster using `delegate` or `delegate_parallel`. There is no stored Team entity. A child run inherits the
parent's abort signal and budget, gets a private ephemeral session, and records billed attempts with
`parentRunId`. A routed child may ask for one exact dangerous-tool approval through the parent chat; a
headless child stays approval-unavailable. Children never inherit parent bypass or remembered approval.
The roster authorizes *selecting* a child, and the child's own tool allowlist authorizes *its calls*;
the parent's tool allowlist is not a delegation ceiling. Bounds: roster, depth, total fan-out, parallel
fan-out, self-delegation, ancestor cycles.

**Research.** Foreground only and run-scoped: no background task, research id, async control command or
durable resume. It shares the run's abort signal and budget and ends with it; Ctrl+C, `/stop` or channel
cancellation tears it down in order. The root `chat` agent picks the smallest sufficient capability
inside the normal tool loop (answer, one clarification, `research`, `delegate`, or one
`delegate_parallel`); `/research` starts the same path through the deep-research entry agent without
changing the agent binding. Pipeline, depths, evidence admission, outcomes, failure codes and bounds:
[Research](../research.md).

Retrieval is configured-default-first: the default provider always runs before any fallback, and Exa
runs only when configured as default or fallback (credentials alone never select it). Every retrieval
attempt is a typed record. Exa search metadata (request id, requested and resolved type, engines) is
kept; Contents items and typed failures (`errorTag`, `httpStatus`) are kept per URL; a partly failed
Contents call is `partial`. A billed provider response is recorded **exactly once** in cost and budget
accounting; cache hits cost zero.

**Presentation of research.** CLI and REPL render a verdict-first report (outcome, evidence level, gap and
source counts, claim sections, labelled inference, conflicts, freshness notes, retrieval attempts, next
actions) with color, hyperlinks and paging on a TTY. Telegram renders MarkdownV2 and edits its progress
message in place; Zalo (plain text, no edit) sends chunks.

**Built-in tools.** Defined by `BUILT_IN_TOOLS` in [src/tools/registry.ts](../../../src/tools/registry.ts).

| Area | Tools |
|---|---|
| System | `ask_clarification`, `now`, `todo_write` |
| Calculation | `calc` |
| Files | `file_read`, `file_write`, `file_edit`, `file_list`, `file_search` |
| Memory | `memory_store`, `memory_recall`, `memory_remove`, `memory_fts_recall` |
| Shell | `shell_exec` |
| Web | `web_fetch`, `web_search` |
| Scheduling | `schedule_add`, `schedule_list`, `schedule_remove` |
| Skills | `skill_view` |
| Delegation | `delegate`, `delegate_parallel` |
| Research | `research` |

Trading registers its own tools through the same registry, plus `order_place` and `order_exits` when a
venue has exchange credentials; social adds `social_request` and `social_skill`. A tool may declare
`inputExamples`: worked inputs validated at boot, sent natively to Anthropic and appended to the
description on every other wire. Use it only where a model gets the input shape wrong without one (a
union arm, a wall-clock string, a nested object).

Tools validate their schema, pass the capability and approval gates, and return results through the
shared credential scrub, untrusted-output scan and bounded-output pipeline. `todo_write` keeps a bounded
todo list for the current run only; the run holds its own copy so
[compaction](../storage.md#context-limits-and-compaction) cannot summarize it away. File tools work in
the agent workspace. Shell is policy- and approval-gated, with bounded output, stopped on timeout or
abort. Web fetches apply SSRF protection.

**Memory.** Agent- and user-scoped key-value data with exact recall, prefix listing, full-text search,
soft delete and TTL. Values that look like secrets or prompt injections are rejected before storage.
Child runs isolate keys through their ephemeral session namespace. The engine also extracts explicit
user preferences from finished conversations and stores them through the same guarded path.

**Skills.** Folders containing `SKILL.md`, plus trading skills embedded in the binary. The model gets a
compact index and loads a body only through `skill_view`. Embedded names are reserved: a directory skill
that reuses one fails composition instead of shadowing it. Skills are knowledge, not code: they add
nothing executable and bypass no tool policy. See [Agents](../agents.md#skills).

**Plugins and workflows.** Plugins can contribute agents, skills, workflows, declarative slash commands,
safe channel config overrides and external MCP tool descriptors. Contributions merge through ordered
registries; collisions are rejected or skipped. Workflows are sequential runs with optional schedules,
bounded steps and retries, aggregated cost, isolated invalid definitions and propagated aborts. A step
is not retried if it ended on its budget or halted with `length_limit`, `hook_failed`, `content_filter`,
`rate` or `agent_paused`: the same request would end the same way.

**Scheduling.** Interval and cron jobs with persisted time zones, run history, retry with backoff, and
auto-disable of repeatedly failing jobs. `--agent` defaults to `chat`; `--allow-tools` restricts a job to
a subset of the agent's tools. Failures can be delivered independently. Heartbeats are recurring
scheduled work. Scheduler runs do not overlap, use the configured approval mode, and keep the same run,
budget and abort boundaries as any other run.

**Channels.** Telegram, Zalo and Zalo Personal; an adapter is available only once its config and
credentials exist. Admission is allowlist or pairing, never open, enforced before a run starts. Inboxes
and poll offsets are durable and one delivery pipeline serves every adapter. See [Channels](./channels.md).

**Slash commands.** Channels and the REPL expose a surface-filtered, rate-limited catalog.

| Area | Commands |
|---|---|
| Agent routing | `/agent [id\|default]` |
| Model selection | `/model [selector]` |
| Research | `/research [quick\|standard\|thorough] <query>` |
| Status and cost | `/health`, `/cost`, `/config` |
| Memory | `/memory` |
| Scheduling | `/schedule [show\|pause\|resume\|run] <id>` |
| Session | `/new`, `/continue` |

Trading adds its own commands, plus `/trade` when a venue has exchange credentials (the same credentials
open the `sync <venue>` arm of `/record`). Social adds `/social`. Channels own `/stop` and the pairing
controls. Channel role and surface restrictions decide what is offered and whether it needs approval. See
[Commands](../commands.md#trading-chat) and [Trading](../trading.md#themes).

**Models, usage and cost.** The `[[models]]` chain selects a primary model and optional fallbacks.
Transports: OpenAI-compatible chat, OpenAI Responses, Anthropic Messages, Gemini Generate. Attempts
stream, retry and fall back within bounds, and normalize reasoning and usage. Every attempt is settled
once; durable records hold provider and model, input, output, cache and reasoning tokens, latency, price
source, cost, and the parent run. Budgets enforce daily, monthly and per-run caps, warn softly, and slice
the remaining budget across parallel child runs. `cost` reports spend against caps; `provider` shows
configured pricing.

**Persistence.** SQLite by default, PostgreSQL also supported. The boundary is `Storage` plus `Dialect`,
with generated migrations, store-owned queries and per-dialect full-text search. `db` reports migration
state, integrity and statistics, applies migrations, runs retention cleanup and resets data. SQLite also
has verified backup and restore; PostgreSQL does not claim SQLite-only backup, restore or deep integrity.
Retention covers old sessions, routes, memory, scheduler runs, channel inbox entries and pairings.
`workspace cleanup` reclaims agent workspace data behind an explicit confirmation.

**Safety and approvals.** Dangerous tools use manual approval, explicit bypass, or unavailable.
Remembered decisions are scoped to the session. A routed child (interactive REPL, interactive
`chat --message`, channel run, targeted scheduler job, channel-invoked workflow) may ask for one exact
dangerous-tool approval through the parent chat. A headless child (non-interactive one-shot, headless
scheduler, heartbeat, scheduled or CLI workflow, direct MCP call) stays approval-unavailable. The runtime
also enforces workspace containment, private-file denial, SSRF and pinned-fetch checks, credential
scrubbing, untrusted-output scanning, shell policy, bounded results and abort-driven cleanup. Agents call
tools; tools own database access.

**Logging.** Main and agent logs are structured and scrubbed, with rotation, retention and a bounded
async queue. `logs` filters, follows or clears per-agent output. Per-agent run logs are separate from
workspace scratch data, so `workspace cleanup` leaves them; `logs clear` deletes them by age or scope.

**Diagnostics and lifecycle.** `doctor` checks config, models, data directory, logging, database, daemon,
channels, delivery, sources, venues, web search and providers; its optional online checks probe remote
integrations without changing local state. `status` summarizes daemon, channels, sessions and spend. The
daemon owns a PID file, recovers stale runs at boot, and shuts down in order: stop new work, drain active
work, close services. CLI cancellation propagates into active runs and exits cleanly. Top-level CLI
commands are `BUILT_IN_COMMANDS` in [src/cli/registry.ts](../../../src/cli/registry.ts); trading adds no
CLI command. For the programmatic surface see [Extending](./extending.md#the-sdk-surface).

**The key file loads first.** `main()` reads `<data dir>/env` (`src/cli/env-file.ts`) right after the
global flags and before the pre-boot config probe, since config resolution reads keys from `process.env`.
It is the only boot-time write to `process.env`: it sets names the environment leaves empty, skips the
brand-prefixed ones, and leaves a file other users can read untouched (`CliApp.keyFile` carries which names
it set). The data dir is the bootstrap one (`--data-dir`, the data-dir variable, the default), so
`[paths] data_dir` cannot move it.

**Keys never stop a start.** Boot resolves with `deferMissingKeys`: a model entry whose key variable is
unset keeps `missingEnv` (the chain skips it, and with none left every call rejects with the
localized `MissingEnvError`), and an MCP server naming an unset `${VAR}` lands in `ResolvedMcp.unset`
instead of failing the resolve. `doctor` and `probeConfig` resolve strictly, so they still fail. Each
detector logs once where it finds the gap (`llm.key_missing` when the chain registry is built,
`web_search.key_missing`, `mcp.env_missing`), and `toMissingKeyErrors` in `src/cli/missing-keys.ts` is
the one list the terminal prints and `config validate` reports. A channel whose `start()` throws
`OperatorConfigError` (token missing or rejected) is disposed and logged `channel.start_skipped`;
`startChannels` returns it in `skipped`, so a channel that never listened admits nobody. An
`ApiTokenError` from the API starter is handled the same way (`api.token_unusable`). The daemon task
hands both lists to its `onReady` handler (`DaemonReadyHandler`); the foreground `start` prints them on
stderr, and a background child's stderr log is relayed under the parent's success line. The handler
then writes the ready file (`BRAND.readyFile`, atomically, `{ pid, degraded }`) that a background start
waits on and `status` and `/v1/state` read back; a start clears it as it claims the pid file, so a file a
crashed daemon left behind never reads as ready for a reused pid. A loop tick
failing with `MissingEnvError` is a boundary failure (`trading.tick_key_missing` once per loop until
another failure is logged, retried next interval), never a quarantine.

**Limits of order execution.** `/trade` and `order_place` place spot orders on a registered venue, and
nothing else in the codebase can submit one: a new exchange adds a `SpotAdapter` behind that same
feature. Until a venue carries credentials, `order_place` is not registered. `/trade halt` switches every
new buy off until `/trade resume`, durably and without touching a resting exit. Nothing fabricates a
fill: `[trading.venues.<id>] simulated` still signs, submits and polls a real API against the exchange's
demo book. Assets cannot move between venues.

### MCP

`mcp serve` exposes the allowed runtime tools over MCP, with server instructions that tell the host's
model how to use them. When the client supports elicitation, tool approval is requested through it. The
lists of exposed and withheld tools are in [Commands](../commands.md#mcp).

Under `mcp serve` the connected client's model stands in for the provider chain:

- The command declares `Needs.modelSource: 'client'`. Boot builds one stand-in `client` model as the
  primary chain, reads no `[[models]]` or `[web_search]`, and runs every agent on it.
- `[model_tiers]` are still read for a lookup that names one, with no primary fallback and no boot key.
  A tier is built on first lookup and skipped (`llm.tier_skipped`) when it cannot be built.
- [src/ai/client-model/](../../../src/ai/client-model/) posts each request to the broker
  ([src/engine/mcp/jobs/broker.ts](../../../src/engine/mcp/jobs/broker.ts)) under the job id that
  `AsyncLocalStorage` carries. Each served call is a job on its own session
  ([src/engine/mcp/jobs/jobs.ts](../../../src/engine/mcp/jobs/jobs.ts)); the pending requests of one round
  are listed as `model_requests`.
- Both halves of a request's wait are logged (`mcp.request_viewed`, `mcp.request_answered`). `serveMcp`
  drains the jobs before the store closes.

Every MCP run carries `audience: 'operator'` (`RunOptions` to `ToolInvocationContext`); other runs are
`agent`. Under `operator`, suggestion tools keep `units` and `portfolio_rebalance` reads
`rebalanceWithUnits`, while `held`, `policyUnits`, cash, cost and NAV stay withheld.
`check-feature-isolation` fails any tool that names an absolute read. The `report` the suggestion tools
return is rendered with `operatorFigures: 'withheld'`: a render line that states a holding's size or cost
has a `Withheld` catalog twin chosen by `withheldSuffix`, and `scripts/check-report-figures.ts` fails a
report that prints cost or policy size, or one that changes when only they change.

The runtime also connects to external MCP servers over stdio or Streamable HTTP. Discovery and calls are
bounded. External tools are namespaced, treated as external and approval-gated; sub-agents cannot call
them. Config-supplied stdio commands and HTTP endpoints get targeted safety checks.

### Limits at a glance

Resolved defaults. A config key is shown where one exists; `Fixed` has none.

| Limit | Default | Config key |
|---|---|---|
| Daily spend cap | Disabled | `[budget] max_daily_usd` (`0` disables) |
| Monthly spend cap | Disabled | `[budget] max_monthly_usd` (`0` disables) |
| Per-run spend cap | Disabled | `[budget] max_per_run_usd` (`0` disables) |
| Soft budget warning | 80% of an enabled cap | `[budget] soft_warn_ratio` |
| Run turns | 40 | `[loop] max_turns` |
| Run tool calls | 120 | `[loop] max_tool_calls` |
| Run duration | 15 minutes | `[loop] max_duration_ms` |
| Approval wait | 2 minutes | `[loop] approval_timeout_ms` |
| Session messages | 500 | Fixed |
| Delegation depth | 3 | `[loop] delegation_depth` |
| Total delegations | 32 | `[loop] max_delegations` |
| Parallel delegations | 5 | `[loop] max_parallel_delegations` |
| Research questions | 7 | Fixed |
| Research review rounds | 2 | Fixed |
| Research excerpt chars | 4000 | Fixed |
| Research excerpts per source | 8 | Fixed |
| Research artifact bytes | 128 KiB | Fixed |
| Research full text per source | 64 KiB | Fixed |
| Scheduler tick | 30 seconds | Fixed |
| Scheduler starts per tick | 5 | Fixed |
| Global scheduled runs | 50 | Fixed |
| LLM calls per minute | 60 | `[llm] max_calls_per_minute` |
| LLM retries | 2 | Fixed |
| Log rotation | 50 MB, 7 files | `[log] max_file_mb`, `[log] max_files` |

---

## Surface UX contracts

CLI and channels share execution policy and own their presentation. The engine emits structured events
and typed results; each surface renders them in the active locale within its transport's capabilities.

### CLI output modes

`--quiet` and `--verbose` are mutually exclusive, and their state stays inside the CLI process (not
mirrored into environment variables). Color respects TTY capability, `NO_COLOR` and `FORCE_COLOR`.
Normal output goes to the injected writer, errors to the error writer. Modules outside `cli` do not use
`console.*`.

Without `--verbose`, a terminal error shows a scrubbed summary and a hint to rerun with it. Verbose adds
a bounded, credential-scrubbed stack and up to four causes.

### Tool presentation

Source: [core/tool.ts](../../../src/core/tool.ts),
[engine/loop/tools/presentation.ts](../../../src/engine/loop/tools/presentation.ts),
[core/stream-events.ts](../../../src/core/stream-events.ts).

```ts
interface ToolPresentation<I> {
  readonly label?: string
  readonly emoji?: string
  readonly detailKeys?: readonly string[]
  detail?(input: I, locale: Locale): string | undefined
  readonly lifecycleOwner?: ToolLifecycleOwner
}
```

`lifecycleOwner` is `'tool'` (default) or `'progress'`. A `'progress'` tool (only `research` today)
suppresses the surface's own start and result rendering and drives the display entirely through
`tool_progress`, so its live view is not wrapped in a second generic tool line.

Presentation is descriptive only. Approval depends on capability, `requiresApproval` and external origin.
The engine resolves it once:

1. use the declared label and emoji, else humanize the tool name;
2. take detail from the tool's own `detail(input, locale)`, else only from declared `detailKeys`. An
   external MCP tool that declares neither gets its arguments summarized as `key=value`, so an approval
   prompt is never blind;
3. scrub credentials and control characters;
4. cap label and detail lengths.

Surfaces consume `tool_execution_start` and `tool_progress`. They never read raw tool arguments or
rebuild display policy. A `tool_progress` param may be a keyed message
(`{ market: { key: 'trading.market.crypto' } }`) that the surface resolves in the viewer's locale, so a
reporter deep inside a market never needs a `Locale`.

### CLI live rendering

Interactive chat shows sparse state, not every transport delta: a spinner while the model or a tool
runs; the safe tool label, detail and progress milestones; success or failure summaries from
tool-result events; model, latency and context metrics when available; final text and usage once the turn
settles. Control characters and credentials are scrubbed first.

A slash command that declares `execution` shows its progress through one of two renderers chosen by
`isInteractiveStdout`: the spinner on a terminal, and on anything else (a pipe, a log, `CI`) a line
writer on stderr that prints a changed label at most once per `LINE_PROGRESS_INTERVAL_MS`. Both take the
same labels from the command's reporter, so `/refresh` lines stay built in one place, and the line
writer holds no timer or listener. Stdout stays the answer alone.

### Channel live HUD

With `mid_stream_updates = true` and an adapter that can edit, delivery keeps a live HUD:

```text
Elapsed: <seconds>s
<status glyph> <emoji> <safe tool label>: <detail or progress>
<research milestones, when a research run is live>
```

`Elapsed` is localized. A tool's checklist or extra progress lines indent under its line; research
milestones (start, plan, question, stage, warning, totals) follow the tool lines. Edits are throttled to
one per 1.5 seconds. A transport without editing gets ordinary sends and the final result. Typing
indicators and reactions are on only when both config and adapter capabilities allow.

### Run results and halt errors

Engine runs settle with a `RunResultReason`:

```text
completed, aborted, budget, error, turn_limit, loop, timeout
```

Channels keep useful partial text and append a localized reason when a run stops early. A completed run
with no text uses localized no-content copy. A thrown `RunHalted` maps through `HALT_SPEC` in
`core/errors.ts`; CLI exit codes, emoji and localization keys come from that table, not from a
per-surface phrase list. A `budget` halt also carries a detail naming the ceiling that refused it, and
`failureSpecOf` prefers the detail's text. Unexpected terminal failures are credential-scrubbed: channel
users get generic localized copy, terminal users see internals only with `--verbose`.

### Cost display

Surfaces format the same `LLMUsageTotals` facts with the shared cost formatter: input, output and cache
tokens, cost, context use, and the configured run, day and month budget tiers. They never recompute
pricing or caps.

### Approval prompts

| Mode | Behavior |
|---|---|
| `manual` | Safe calls pass; dangerous or external calls need an operator decision. The default |
| `bypass` | Calls pass without prompting. Must be chosen explicitly |
| `unavailable` | A dangerous call is blocked because no prompt can be delivered |

There is no `safe` mode. Choices are `deny`, `once`, and `remember` where the scope supports it.
Remembered approvals live in session memory and clear with the session; scheduler and delegated scopes
allow one-time decisions only. Two identical pending calls in one run share a prompt. Timeout and abort
settle the waiter and clean up listeners and timers. A caller that cannot prompt must use
`unavailable`, never wait forever. Interactive CLI chat prompts in the terminal; a non-interactive
one-shot forces `unavailable` unless the operator passes `--mode bypass`. Telegram can use inline
buttons; other adapters may send approval text but must respect their declared capabilities and the same
engine decision contract.

### Localization

The localization leaf supports `en` and `vi`. Locale is per run, so concurrent runs can render different
languages without shared mutable state. `t(locale, key, params)` looks in the requested catalog, falls
back to English, then returns the key. Placeholders are named, such as `{brand}`. CLI and channel copy
both come from the catalogs, and branding is injected as a parameter, not baked into values.

### Channel capabilities

Delivery branches only on the capabilities a channel declares (`inlineButtons`, `markdown`, `typing`,
`reactions`, `canEdit`, `maxTextLen`), never on its name. Interface:
[Channels](./channels.md#the-adapter-contract).

### Line width per destination

A renderer never assumes a width. `resolveRenderContext(timezone, surface)` answers one per destination:

| Destination | Layout | Width |
|---|---|---|
| repl | `table` | 90 |
| channel (telegram, zalo) | `lines` | 45 |

`toFactLines` joins as many facts onto a line as the budget holds and starts a new line instead of
splitting a fact, because a cut inside one orphans a number from its label.

### Same reading on every channel

Every destination states the same facts in the same words and glyphs; only the shape changes.

- **Numbers are never chart-only.** A chart sits beside the figures it draws.
- **One glyph, one meaning.** `●` is today's reading on a ladder, `○` the target or cap on a bar.
  `check-display-contract` fails the build when a glyph takes a second meaning.
- **Shape follows the screen.** The REPL compares rows on an aligned grid, so it skips a chart that only
  restates a column (the allocation bar). A phone stacks rows, and there the bar is what makes them
  comparable. Ladders show on both.
- **Charts never line up across lines.** Telegram and Zalo use proportional fonts, so no chart depends
  on a column another line sets.
- **No charts where a model relays the text.** `RenderContext.charts` is false on `TOOL_SURFACE`: the
  model copies that text word for word, and the figures beside a chart already carry its reading.

Charts come from `render/chart.ts` (`renderLadder`, `renderBar`); a new chart takes its glyphs from
there.

### Affordances

A command may hand back the commands a reader could run next, each a label plus a slash command. A
channel with `inlineButtons` renders them as an inline keyboard on the last chunk. A channel without
buttons, and the CLI, print one line per affordance naming the command. A payload past Telegram's 64-byte
`callback_data` limit degrades to a line. Nothing exists only as a button, and a tap carries the command,
not a snapshot, so a button pressed tomorrow runs on tomorrow's data.

### Pairing UX

An unknown user on a pairing channel gets a localized one-time code and instructions to contact an
operator. Repeat messages stay inert until the request is approved, denied or expires. Only configured
operator identities can run pairing controls, so a paired user is not automatically an operator.
Admission rules, including failing closed on a storage fault: [Channels](./channels.md#admission).

### Text safety

Every user-controlled label, command description, tool detail, provider error preview and channel payload
is bounded and scrubbed before display. Markdown renderers escape transport syntax and chunk by code
point so surrogate pairs are not split. No surface may show raw secrets, unsanitized plugin text or
arbitrary tool arguments.

---

## Source map

- [AGENTS.md](../../../AGENTS.md): module DAG, boundary rules, business invariants
- [scripts/check-dag.ts](../../../scripts/check-dag.ts): the architecture gate (`CORE_PUBLIC`)
- [src/app/providers.ts](../../../src/app/providers.ts): provider order
- [src/tools/registry.ts](../../../src/tools/registry.ts): `BUILT_IN_TOOLS`
- [src/cli/registry.ts](../../../src/cli/registry.ts): `BUILT_IN_COMMANDS`
- [src/core/tool.ts](../../../src/core/tool.ts), [src/core/stream-events.ts](../../../src/core/stream-events.ts): tool presentation
- [src/core/errors.ts](../../../src/core/errors.ts): `HALT_SPEC`, `failureSpecOf`
- [src/trading/render/format.ts](../../../src/trading/render/format.ts): `resolveRenderContext`
- [src/engine/mcp/jobs/](../../../src/engine/mcp/jobs/), [src/ai/client-model/](../../../src/ai/client-model/): `mcp serve` client model
- [Extending](./extending.md), [Channels](./channels.md)
