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

**Live feed and command lane.** The engine and the command dispatcher put the run lifecycle on the bus
(`run_started`, `run_progress`, `run_thinking`, `run_finished`, and `command_started`, `command_progress`,
`command_finished` for long-running slash commands); the app adds `order_filled`, `alerts_checked`, `role_output` (what each debate role said, from a
trading seam bound in `app`) and `agent_added`, and the engine adds `budget_exhausted`, `tool_started`
and `tool_finished` (one finish per call that has a registered tool, after a start only if it reached its
tool).

Three notice kinds (`call-scored`, `held-news`, `index-drop`) are bell-only: the notice sender files
them with `DeliveryHub.post`, which tells the delivery listeners and sends to no chat, unless
`[notices] chat` lists the kind (checked against that set at boot). A scored focus call is not a notice: the scorer
hands it to the `onFocusCallScored` seam with the agents `agent_focuses` lists for its focus, `app` emits
`focus_call_scored` on the bus, and the feed sends one quiet `call_scored` per agent to the sockets, which the bell
and the chats never see.

The idea watch ([app/server/push/ideas.ts](../../../src/app/server/push/ideas.ts)) reads,
once a minute, the newest open calls of the operator's own focus and of each `[focus]` the own agents use now, and
sends each new buy or reduce as `idea`: from the app for the operator's own, quiet and once per agent for a focus (a
focus no agent has called under yet lists nothing). The held-name watch runs inside the
alerts loop; its cursor starts at boot and its dedupe sets reset at the day change.

[app/server/feed/](../../../src/app/server/feed/) folds them into the run book
behind `GET /v1/live` and broadcasts each to the open sockets; `approval_requested` and
`clarification_requested` carry their ids and `askedAt` so the pending list can hold them. Wire shapes:
[CONTRACT.md](../../../src/app/server/CONTRACT.md).

Self-contained commands run in a per-chat command lane
([core/command-lane.ts](../../../src/core/command-lane.ts)), three running and ten waiting per chat, shared by
every surface that reaches the chat; `/new`, `/stop` and the socket's `cancel` drop the waiting ones and stop the running ones, and `drop`
takes out one waiting command.

`POST /v1/runs/:runId/stop` stops one run from any channel: it tries `RunRegistry.abortRun` (an agent run), then `SlashDispatcher.abortCommand` (a long-running command), and aborts only, so the run ends through its own path and shows as `run_finished`; an unknown or finished id is `not_found`.

`GET /v1/runs/:runId/calls` ([routes/runs.ts](../../../src/app/server/routes/runs.ts)) lists the billed model calls of a run and everything beneath it, newest first, through `SpendReader.callsForRun` over `LLMAttemptStore.attemptsForRun`; the tree is the `runTreeCtes` text ([persistence/stores/run-tree-sql.ts](../../../src/persistence/stores/run-tree-sql.ts)) that `/v1/activity` prices a run with, so the totals agree.

- It returns at most `RUN_CALLS_MAX` rows, and `totalCalls` and `totalUsd` count the whole tree even when `truncated` is true, so the page's head line reads them and never sums the rows.
- A row is metadata only (no prompt or answer) and operator only: nothing here reaches a model input.
- A malformed id is `invalid_body`; an unknown or unbilled run is an empty list.
- The page's `RunCalls` fold ([web/ui/run/calls/](../../../src/web/ui/run/calls/)) reads it when opened, keeps the runs that had ended in a capped cache (`RUN_CALLS_CACHE_MAX`), and reads a running run again on its `run_finished`, never on a timer.

One `/suggest` runs per identity and depth: a second finds the run in the suggestion service's
flight map and waits on it, and the starter alone is billed.

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
user preferences from finished conversations and stores them through the same guarded path. An
attribute already saved is never overwritten by extraction: the change is put to the operator once, at
the start of the next reply, and saved only if their next message agrees. A scheduled or piped run
has nobody to ask, so it never proposes one.

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
| Scheduling | `/schedule [show\|pause\|resume\|run\|remove] <id>` |
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
names that steer the program itself (`BRAND.controlEnv`: data dir, background mark, log level, editor
file) and the names that steer how a program starts (`PATH`, `HOME`, `SHELL`, `TMPDIR`,
`TZ`, `LD_*`, `DYLD_*`, `NODE_*`, `BUN_*`), and leaves a file other users can read, or this user cannot
open, untouched (`CliApp.keyFile` carries which names
it set). The data dir is the bootstrap one (`--data-dir`, the data-dir variable, the default), so
`[paths] data_dir` cannot move it.

**Keys never stop a start.** Boot resolves with `deferMissingKeys`: a model entry whose key variable is
unset keeps `missingEnv` (the chain skips it, and with none left every call rejects with the
localized `MissingEnvError`), and an MCP server naming an unset `${VAR}` lands in `ResolvedMcp.unset`
instead of failing the resolve. `doctor` and `probeConfig` resolve strictly, so they still fail.

Each
detector logs once where it finds the gap (`llm.key_missing` when the chain registry is built,
`web_search.key_missing`, `mcp.env_missing`), and `toMissingKeyErrors` in `src/cli/missing-keys.ts` is
the one list the terminal prints and `config validate` reports.

A channel whose `start()` throws
`OperatorConfigError` (token missing or rejected) is disposed and logged `channel.start_skipped`;
`startChannels` returns it in `skipped`, so a channel that never listened admits nobody. An
`ApiTokenError` from the API starter is handled the same way (`api.token_unusable`), and so is
`ApiPortInUseError` (`api.port_in_use`): either leaves the API closed as a `kind: 'api'` degraded item and
the daemon running. Any other API start failure still stops the start. Each maintenance disposer is
registered as its subsystem starts, so a later one that throws cannot lose an earlier one.

The daemon task
hands both lists to its `onReady` handler (`DaemonStartOptions.onReady`); the foreground `start` prints them on
stderr, and a background child's stderr log is relayed under the parent's success line.

The handler
then writes the ready file (`BRAND.readyFile`, atomically, `{ pid, degraded }`) that a background start
waits on and `status` and `/v1/state` read back; a start clears it as it claims the pid file, so a file a
crashed daemon left behind never reads as ready for a reused pid. The pid file also records `startedAt`. A start that reclaims a stale pid file (`PidFileClaim` `reclaimed`)
passes `DaemonStartOptions.previousRun`, so the daemon messages the default chat once (`cli.daemonStoppedUnexpectedly`),
and `status` reads the same file through `readStalePid`.

A loop tick
failing with `MissingEnvError` is a boundary failure (`trading.tick_key_missing` once per loop until
another failure is logged, retried next interval), never a quarantine.

**Signing in to the office page.** `api token` and `api rotate` ([app/server/cli/api-command.ts](../../../src/app/server/cli/api-command.ts)) share `readApiToken(app)` with `web` and `connect`: `[api] token_env` when set (an empty variable is an error), else `<data_dir>/auth/api/token.json`. A browser never holds that token, and the page drops any `#token=` fragment from its address on load without reading it.

**Codes.** `web` ([app/server/cli/web-command.ts](../../../src/app/server/cli/web-command.ts)) posts to `/v1/session/code` with the bearer token and prints `<origin>/#code=<code>`; the code book ([http/sign-in-codes.ts](../../../src/app/server/http/sign-in-codes.ts)) lives in memory per API start, holds at most 16 codes keyed by an HMAC under the token, expires them lazily after five minutes with no timer, and spends a code on its first `take`, so two tabs racing one code see one winner and a restart drops every pending code.

**Sessions.** The page trades the code at `POST /v1/session` for a row in `browser_sessions`: a public UUID plus an HMAC of the cookie secret keyed by the token, so a token change makes every old row unreadable.

- The cookie is `HttpOnly; SameSite=Strict; Path=/`, named `oa_session_<port>` on loopback (two daemons on one host never share a jar) and `__Host-oa_session` through `public_url` (Secure, no `Domain`).
- Idle rows expire after 30 days; a touch at most hourly renews the row and re-sends the cookie, and a failed touch only logs.
- One transaction prunes idle rows and enforces the cap of 20 on every insert.
- A cookie counts only with `Sec-Fetch-Site: same-origin`, and a write also needs the page's `Origin`; the socket handshake counts it on the page's `Origin` alone.
- An `Authorization` header that is not `Bearer` (a proxy's basic auth) is ignored, so the cookie is still read.

**Lockout.** The lockout counts wrong tokens and wrong or used codes, never an unknown cookie, per key from `resolvePeerKey`: the peer address with no proxy header, `proxied:<last X-Forwarded-For hop>` through the `public_url` host, and one `proxied:?` for proxy headers on any other host. Each lockout doubles the last up to `MAX_LOCKOUT_MS`, and an entry is pruned only after `MAX_LOCKOUT_MS` with no failure and no lockout; while it holds, `isAuthLocked` refuses a token or code before it is compared (a code stays unspent), a session still passes, and a valid token or code clears it once it ends.

**Sign-out and rotation.** Sign-out and `DELETE /v1/sessions/:id` remove the row and close that session's sockets with 4401; a socket that opens while its row is being removed is closed too. `api rotate` writes the new token, prints it, then removes every row (`browserSessionStore.removeAll`) and says how many. A running daemon keeps the old token in memory, so `rotate` reads that token before writing the new one and asks the daemon to restart `now` through `restartDaemonWith` ([cli/restart-client.ts](../../../src/app/server/cli/restart-client.ts)), the path `restart` uses; when the daemon cannot be asked or does not come back, it fails and names `restart`.

**Printing.** The one place that prints the token is `connect`, which prints an address line (`<public_url>` or `<brand>+ssh://user@host[:port]?api=<port>`) and a separate token line for the desktop app, so the token never sits inside a URL a browser could open; the address is built from `SSH_CONNECTION` ([cli/ssh-address.ts](../../../src/app/server/cli/ssh-address.ts)). `web` opens a browser only on macOS or on Linux with a display, never over SSH, never awaits the opener, and over SSH prints a tunnel on the server port plus 10000 with `ExitOnForwardFailure=yes`. The `start` summary prints only the `cli.daemonPage` line, which names `web` and never a token, because a `--background` start logs the summary. `GET /v1/health` carries `brand` (`BRAND.display`) so the page's sign-in screen names the product before auth.

**Where a request may come from.** `resolvePageOrigin` ([http/auth.ts](../../../src/app/server/http/auth.ts)) turns the `Host` header into the page's origin: a loopback name on any port, or the host of `public_url` (stored as `URL.origin`, parsed under its own scheme, so `:443` is the same host). Anything else is refused.

- Without `public_url`, a request carrying `X-Forwarded-For` or `Forwarded` is refused with a sentence naming `public_url`. That catches a proxy that forwards either.
- A proxy that sends neither and passes a loopback `Host` (a bare nginx `proxy_pass`) is indistinguishable from a local client, so the guides tell the operator to set `public_url` before exposing the daemon.
- In the compiled binary, the page and its chunks answer with a CSP (`frame-ancestors 'none'`), `Referrer-Policy: no-referrer` and `nosniff` ([http/page.ts](../../../src/app/server/http/page.ts)). A source run serves the page through Bun's `routes`, which carry no headers, so the page's own frame guard covers framing there.

**What an exposed API withholds.** With `public_url` set, `withApiRunLimits` ([app/server/exposure.ts](../../../src/app/server/exposure.ts)) wraps the `runner` service:

- An app-channel run is never offered what `isClientApprovalWithheld` names (the same predicate `/v1/mcp` uses: `shell` capability, `file_write`, `file_edit`, the social tools and every external tool), nor `order_place` while `[api] orders` is off. The wrap reaches the children of such a run.
- A job the app creates without a target is aimed at the app channel, so it runs under the same limits. A job for another chat is refused.
- Pairing approve answers 409 naming `pair approve`, the config guard refuses `channels.<id>.{allowed_ids, operator_user_ids, pairing, dm_policy}`, and every order route plus `/trade` on the socket answers as off.

`api`, `update` and `trading.orders.allow_unattended` are CLI-only whether or not `public_url` is set.

**Running a command in the daemon.** Everything under `src/cli` reaches the process through one object, the terminal ([cli/terminal.ts](../../../src/cli/terminal.ts)): `stdin`, `stdout`, `stderr`, the nine environment names it may read (`NO_COLOR`, `FORCE_COLOR`, `TERM`, `CI`, `LANG`, `LC_ALL`, `LC_CTYPE`, `VISUAL`, `EDITOR`), the quiet, verbose and no-color flags, `onInterrupt` and `onTerminate`, and `openEditor`. The entry installs the process-backed one as `app.terminal`. `currentTerminal()` returns the one scoped by `withTerminal(terminal, fn)` (an `AsyncLocalStorage`), else the process one.

Quiet and verbose live on the terminal, not in module state, because the daemon may run several forwarded commands at once. A gate in `scripts/check-conventions.ts` keeps it that way: `process.stdout`, `stderr`, `stdin`, `env`, `cwd`, `on`, `once`, `off`, `emit`, `exit`, `removeListener`, `prependListener` and `addListener` are refused under `src/cli` except in `terminal.ts`, `env.ts` and `commands/daemon/daemon.ts`.

The daemon side is `app/server/exec/`: `admission.ts` (the pre-upgrade checks and the seat cap), `connection.ts` (frame parsing, the first-frame deadline, close paths), `terminal.ts` (a terminal backed by the socket) and `run.ts` (`runCli` against it, inside `withTerminal`, then a user-agent reload after a successful `agent add`, `edit` or `remove`). Every frame the socket delivers (input, resize, an edit's answer, a signal, the close) runs inside `withTerminal` too, so a callback never reads the daemon's own process. The wire shapes are `wire/exec.ts` and section 6 of [CONTRACT.md](../../../src/app/server/CONTRACT.md).

Whether a command forwards comes from `Needs`, not a list. `isForwardable` in [cli/command.ts](../../../src/cli/command.ts) wants `boot`, `daemon: 'any'`, `bootMode: 'cli'`, a `modelSource` other than `client`, and no `local: true`, which marks the commands that read or write a file the operator names, plus `api`. `--local` or a `--log-level` flag never forwards.

The client has three parts:

- `app/server/cli/exec-target.ts`: a live daemon for this data folder with this config file and version, `[api]` on and not degraded, a readable token;
- `exec-client.ts`: the handshake, then the relay;
- `exec-relay.ts`: stdin, raw mode, resize, editor, signals.

How a failure ends:

- A failed or slow handshake (`EXEC_OPEN_TIMEOUT_MS`), or a refusal (close 4400) before `accepted`, falls back to running here.
- Any other close after `exec` went out counts as lost, and after `accepted` the command is never run again.
- A close without `exit`, or `EXEC_LIVENESS_TIMEOUT_MS` (300 seconds, 2.5 times `SOCKET_IDLE_TIMEOUT_SECONDS`, the cadence of the daemon's pings, re-armed by every frame and ping) without a sign of life, is exit 17.

The version compared is `BRAND.version` only. Run from source without a version bump and the CLI forwards to an older daemon without a word: use `--local`, or restart the daemon.

**Restart from the API.** `POST /v1/restart` calls `SelfUpgrade.restart` ([app/update/install.ts](../../../src/app/update/install.ts)), which refuses a daemon that cannot restart (no in-place restart and not launched with `--background`), one shutting down, and one whose upgrade or restart is already pending; the answer is 202 once accepted.

`when: 'idle'` then polls `isWorking` (runs, long-running commands, deliveries, trading tasks) until nothing works or `RESTART_IDLE_WAIT_MS`, on an abortable `sleep` that shutdown cancels; `now` skips the wait.

**In place.** Where `canRestartInPlace()` holds (not Windows, and `process.execve` exists), [app/update/restart.ts](../../../src/app/update/restart.ts) sends this process `RESTART_SIGNAL` (SIGUSR2), the signal an operator's `kill -USR2` sends too: `runDaemon` marks the restart and aborts the daemon like SIGTERM, so the one shutdown path runs (`SHUTDOWN_DRAIN_MS` is the grace runs get before they are cut, shown as `restartDrainMs` on `/v1/state`; it is not the downtime, so a page detects a restart as health going down, then up again with the same pid), and approvals still waiting are refused. A SIGINT or SIGTERM while it drains forces the exit as usual, so nothing restarts.

Once the run has exited cleanly and `boot` is disposed, `main` calls `restartInPlaceIfRequested` ([app/update/exec-restart.ts](../../../src/app/update/exec-restart.ts)): it writes `<data_dir>/restart.json` (`{ requestedAt }`) and calls `process.execve` on the command line this process started with (`resolveSelfCommand` plus `process.argv`), with the environment minus the names the key file set, so the new run reads that file again. The pid, terminal and descriptors 0 to 2 stay; every other descriptor is close-on-exec. An execve that fails removes the marker, prints `cli.daemonRestartFailed` on stderr (the logger is closed by then) and exits 1.

**Through a helper.** Without in-place restart (Windows), `startHelper` writes the marker and spawns `restart --background` as a detached helper (`spawnRestartProcess`, logs `restart.stdout.log` / `restart.stderr.log`), which stops this daemon through the same shutdown.

**Coming back.** The daemon the restart brings up takes the marker once ready (`takeRestartMarker` in `markReady`, never in `boot`, which the helper and the `--background` parent also run) and, when the marker is under `RESTART_MARKER_MAX_AGE_MS` old, files `ui.restartDone` to the bell as a `daemon_notice` of kind `restart-done`, first marking read the earlier unread `restart-done` notices among the newest bell rows, so the bell holds one.

**Requests and failures.**

- A request whose client already hung up logs `api.request_aborted` at debug and is not a failure.
- A request still running when the daemon stops answers 503 `stopping` and logs `api.handler_stopped` at info; the API's stop gives open requests `SHUTDOWN_DRAIN_MS`, then cuts any left (a stalled body) with `server.stop(true)` and logs `api.stop_forced`; the page keeps its last figures and reads again once its socket is back.
- The marker never touches the upgrade announcement, so a restart cannot read as a failed upgrade.
- A helper that cannot start (or a signal that cannot be sent), or a helper that exits while this daemon still runs, removes the marker, releases the pending flag so a new restart can start, and files `ui.restartFailed` to the bell as a `daemon_notice` of kind `restart-failed`, because the page already got its 202 and would otherwise wait for a new pid for good.
- Each request ends in one `restart_ended` bus event (`logRestart`), which the run log writes as one `runs` row named `restart`: `completed` when the stop reaches this daemon (the abort of `app.signal`, so the row lands before the run log stops), `aborted` for a refusal or a stop that came first, `error` for a helper or signal that could not start, or a helper that exited with this daemon still up.

**Reads and small writes for the office page.** `GET /v1/outbound` builds its list in [app/outbound-hosts.ts](../../../src/app/outbound-hosts.ts) from the code that owns each host, so a new provider appears without a second list:

- `listSourceHosts`: the endpoints each adapter pins, `RSS_FEEDS`, and the endpoints of the plugin sources the registry keeps, split into `data`, `news` and `plugin` by the kinds each id is routed for;
- `listPricingHosts`: the price feed;
- `resolveModelHost` over `config.models`: its own `base_url`, else the provider's;
- `ChannelDefinition.apiHosts` for the channels the daemon starts, and `VenueManifest.apiHosts` for the venues holding a key (read through `VenueChoice`);
- the HTTP MCP servers;
- `listSearchHosts`: each backend's endpoint, SearXNG's own `base_url`, nothing for a primary whose key is missing;
- `UPDATE_CHECK_HOST` while `[update] check` is on, the API base of each social network an active agent has joined, and the trading config's reachability host.

A host two purposes share is listed once under each, since what is sent there differs.

`GET /v1/models` prices each model with the pricing service the cost ledger settles with, and `LLMAttemptStore.perRunCostByModel` gives its mean cost per run in one statement: attempts grouped by `(provider, model, run_id)`, ranked newest first per model with `ROW_NUMBER()`, the last `COST_ESTIMATE_SAMPLE` kept, same text on SQLite and Postgres.

`SessionStore.listByChannels` cuts the chat session list in SQL off the indexed `sessions.last_message_at`, which an append stamps when a row the page shows lands (an operator line, or an answer holding text: `isShownMessage`), so a session with none is not listed and `db import` stamps the ones an older export brings without it (channel `IN`, the keyset `(last_message_at, id)` below `before`/`beforeId`, `LIMIT`), and filters by text with `EXISTS` over the rows the page shows, matching the lowered text or the text as typed (`LOWER(content) LIKE ... ESCAPE OR content LIKE ...`, built with `toLikeContainsPattern`; SQLite folds ASCII case only), at most `SESSION_CHANNELS_MAX` channels per request; the first user and last assistant rows ride the same statement and the app decodes, scrubs and cuts them.

Smaller points:

- `POST /v1/watchlist` is two host calls, `remove` then `add`, through the same all-or-nothing resolver as `/watchlist`, so they are not atomic.
- `StatePayload.firstRun` reads the provider check `doctor` runs, `ProfileService.isSaved` and one ledger row.
- A ledger draft refused by the schema raises `FieldValidationError` ([core/field-errors.ts](../../../src/core/field-errors.ts)): one `errors.fields.<code>` message per zod issue (`too_small` split by `inclusive` and string `origin`, any code the draft cannot raise reads as `custom`), the field named through `trading.render.ledger.label.<path>`; the dispatcher renders them into `ApiError.fields`.
- `portfolio.shares` calls the same `apportionedSegmentWeights` and `FRACTION_QUANTUM` as `/portfolio` ([features/portfolio/render/segment-shares.ts](../../../src/trading/features/portfolio/render/segment-shares.ts)); a market's `session` is the `hours` its calendar derives from its `CalendarPolicy`, absent for a continuous one; `closeAuction` runs from `closeAuctionStartLocalTime` to the close, only where the market fixes its close in a call auction (HOSE and HNX: 14:30-14:45), and sits inside the `open` phase, so no reader of the session phase changes.

**Records the office page reads.** `startRunLog` and `startNoticeLog` ([app/activity/](../../../src/app/activity/)) run in every process that boots the app, whether or not the API is on, and the caller awaits `stop` before closing storage.

**Run log.** The run log writes one `runs` row per finished long-running command and per agent run whose answer reaches a surface, plus a child of another run; a command that hands the turn to an agent, and a hidden run with no parent, write none. A title never starts with the internal `depth:<level>` prefix of a `/research` run. A child that names itself (`RunOptions.title`) carries the scrubbed head of its answer as `summary` on the bus `run_finished`; the wire event omits it and the log keeps it. The log also keeps the tickers the run's progress lines named (`runs.tickers`, joined by `,`, at most 20) and the research questions it finished of how many it asked (`questions_done`, `questions_total`), so the page can word a finished run's whiteboard after a reload.

**Notice log.** The notice log files every non-`quiet` wire event, built by the same normalisers the sockets are sent, with the channels it also reached, one write after another so each `notices_changed` carries the count after its own row.

**Retention and cost.** Both tables are swept by [persistence/retention-activity.ts](../../../src/persistence/retention-activity.ts) on `[retention] days`; a run's cost is never stored on its row but read from `llm_attempts` through the run tree, which walks `runs.parent_run_id` and `llm_attempts.parent_run_id` (a read billed under a throwaway run id still counts for the run that asked).

**Routes.**

- `GET /v1/activity`, `/v1/research` and `/v1/digest` read `runs` (the digest adds suggestions and brief snapshots, and takes its spend from the same reader as `/v1/cost`); `GET /v1/notices` and `POST /v1/notices/read` read and mark the bell.
- `GET /v1/board` is `createResultBoard`, the last few command answers in memory, so a restart empties it.
- `GET /v1/tasks` reads `taskStatus` ([app/task-status.ts](../../../src/app/task-status.ts)), which the daemon's task wrapper feeds through `TaskPass` listeners, beside the brief schedule and the intraday next time (a failed read of either leaves it out of the payload, never fails it).
- `trackRecordMinSample` on `/v1/state` is `MINIMUM_TRACK_RECORD_SAMPLE`, so the page gates rates on the daemon's own number.

**What the page's settings and tabs read and write.** Route by route:

- `GET /v1/doctor` runs the CLI's own probes (`collectDoctorProbes` with `surface: 'page'`, so the database check is the light one and providers are never probed). The terminal-only checks come back as `cliOnly` rows, and `?check=` narrows the run to one check.
- `GET /v1/update` adds `newer`, the release notes and the upgrade command to the release status.
- `/v1/credentials` lists the names `keyEnvGroups` gives the provider, venue, search and source groups, never one the token, MCP or channel groups read, a control name or a runtime name. It writes the key file with `writeEnvFileValue` (mode 0600, atomic). It and `POST /v1/auth/chatgpt` answer 409 once `isExposedOnDisk` sees `public_url`, booted or saved.
- `/v1/memory` reads `Memory.listScopes` (local scope first, the row cap in SQL), drops the `prefs-pending:` and `prefs-asked:` rows, and forgets by a base64url scope key. A successful `prefs:` write publishes `preference_saved`.
- `GET /v1/market` renders the show path of `/market` (`renderMarketShow`); `/v1/themes` renders the `/themes show` text and its transitions with the command's own sentences.
- `POST /v1/ledger/preview` answers the rate a draft needs (`replacing` leaves out the row an edit replaces). `POST /v1/ledger` refuses a draft whose rate applies but is unstated, with a field error on `operatorFxRate`. `POST /v1/ledger/sync` is `runVenueSync`, the code `/record sync` runs.
- `DELETE /v1/chat/sessions/:id` removes only an `api` or `cli` session with no turn running (`isDeletableChannel`, which also sets the listing's `deletable`); a terminal still open on it re-creates the row of the same id on its next line.
- `GET /v1/cost` adds `jobs` from `rootRunsForRange`, which walks every attempt in the window up to its root run. Spend with no root is `otherUsd`, so the jobs and `otherUsd` sum to the total.

**Agents and schedules written from the API.** **Agents.** [routes/agent-edit.ts](../../../src/app/server/routes/agent-edit.ts) handles a write in this order:

1. It turns the body into TOML (`toAgentToml`: the fixed tool preset, an edit keeping the keys the page does not own).
2. It builds it through `buildUserAgent` (the build boot gives an agent) before touching disk. A refused body is reported as one `errors.fields.*` sentence per zod issue in `ApiError.fields` (`FieldValidationError`, the one mechanism for every route that takes a body; a body over its cap or not JSON is `invalid_body` through `readJsonBody`).
3. It counts the agent folders on disk and writes the file atomically in one turn of the registry's serial queue, refusing the 51st agent of the operator's own (`MAX_USER_AGENTS`, 409 `errors.agentLimit`), so two creates at 49 cannot both pass.
4. It calls `reloadUserAgents` ([app/agent-registry.ts](../../../src/app/agent-registry.ts)): one serialized swap of the live registry that keeps built-in, trading, plugin and extension agents, reads the folder again (a failed read stops before the swap, so running agents and their heartbeat rows stay) and returns `loaded` and `skipped`.

- Create emits `agent_added` once the reload succeeded.
- Delete pauses every enabled job of the agent through `pauseJobsOfAgent` ([scheduler/job/agent-jobs.ts](../../../src/scheduler/job/agent-jobs.ts), shared with `agent remove`), clears its pause row so a later agent reusing the id is not born paused, removes the folder, reloads (which also closes the agent's log route through `syncAgentRoutes`) and files one `daemon_notice` whether or not the reload worked; an agent on a social network is refused.

**Jobs.** `POST /v1/jobs` goes through the same validators as `schedule add`; an event job is a `once` job parked at `EVENT_JOB_PARKED_AT` ([scheduler/event/types.ts](../../../src/scheduler/event/types.ts)) with a `job_event_triggers` row (and `job_event_fires` for the per-name cooldown), both cascading with the job, so every reader branches on `Job.event` and `/v1/state` carries `event` instead of a time for it.

`createAlertFiredListener` ([app/event-jobs.ts](../../../src/app/event-jobs.ts)) starts the matching jobs on an alert's first send, under the daemon's signal, with a prompt saying why; a `price` job arms its alert first and owns it, so removing the job disables the alert and resuming it is refused once the alert has fired.

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
has a `Withheld` catalog twin chosen by `withheldSuffix`, a caveat carrying the operator's own money
reads from its `<code>Withheld` sentence (or drops), and `scripts/check-report-figures.ts` fails a
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

### The office page (`web`)

The `web` module is the office page: a Preact interface with signals for state and a canvas scene, bundled by Bun and served by the daemon at `GET /` (`src/web/api.ts` exports `officePage`, the one thing the server imports). The page itself is static and unauthenticated; everything it reads is `/v1`, behind a browser session. `main.tsx` refuses to run inside a frame before anything else, clears the old `office.token` storage key, and trades a `#code=` in the address for a session before the first load. The code stays in the address until the daemon answers (a refusal included) and is tried again while no answer comes (no connection, or a 5xx such as a proxy's 502 to 504 while the daemon restarts), so a timeout or a restart does not burn the link; a refusal with error code `locked` reads as the lockout, any other shows its sentence as sent.

**What it may import.** `i18n` at runtime, and `import type` from `app/server/wire/*` only. [scripts/check-dag.ts](../../../scripts/check-dag.ts) carries that one exception (`isWebWireTypeImport`). The wire types are therefore the whole contract: a server change that breaks the page fails `tsc -p src/web/tsconfig.json`, the fourth program of `bun run typecheck`. The socket also checks the contract version it was built against and stops, telling the operator to reload, when the daemon speaks another.

**Folders.** [src/web/api/](../../../src/web/api/) is the client: one fetch wrapper with timeouts, the socket with backoff and jitter, `startPoll`, single-flight loads and the sign-in state (code exchange, ended or refused sign-in). [src/web/state/](../../../src/web/state/) is the store, one signal module per concern (session, live runs, chat, agents, cost, preferences, panel). [src/web/text/](../../../src/web/text/) holds the formatters and `tr`. [src/web/ui/](../../../src/web/ui/) is one folder per area with its CSS beside the component. [src/web/scene/](../../../src/web/scene/) is the office. Every user-visible string is a `ui.office.*` key in both catalogs.

**The store and the event hub.** [state/feed.ts](../../../src/web/state/feed.ts) owns the one socket. On every connect it takes a snapshot (`GET /v1/live`), holds the events that arrive meanwhile in a bounded buffer and replays them in order, merges runs by `runId`, and keeps a short list of finished runs so a late event never revives one. It also resyncs on a timer (`LIVE_RESYNC_MS`). A failed snapshot is retried on the backoff and never closes the socket, since closing it would stop the chat turns and commands it carries. After applying an event to the store it publishes it once on the hub in [state/events.ts](../../../src/web/state/events.ts): `onWireEvent(kind | 'any', handler)`, with one handler's fault never stopping another. The scene, the notices and the office life subscribe there and nowhere else.

**Scene layers and their gate.** Under `scene/` the folders are ranked: `world` (floors, rooms, props, seats, doors, nav grid, the seeded generator), `clock`, `data` (the `/v1` signals the scene reads), `sim`, then `render2d`, `render3d` and `sprites` (one rank, so neither renderer reaches the other: both read the shared palettes, light rows and screen faces in `sprites/`), then `overlay` (every DOM piece over the canvas). A file imports its own layer, a lower one and the root files (`types`, `street-types`, `sky-types`, `renderer`, `budgets`, `view`), never a higher one.

- [scripts/check-scene-layers.ts](../../../scripts/check-scene-layers.ts), part of `bun run lint:arch`, enforces it. So the sim cannot reach a renderer, nothing reaches the 3D renderer except the composer's lazy `import()`, and `three` is imported only under `render3d/`.
- `canvas.tsx` is the composer: it mounts one renderer, drives the loop and hosts the overlays.
- `sims.ts`, beside it, builds what the loop steps (the people, the lift, the office life, the team floor, the street and its painter). No layer imports either file.

**Sun and weather.** `clock/sun.ts` holds the NOAA solar position (`sunAt`, `solarNoonOf`).

- **Fetching.** `data/weather.ts` is the one `fetch` outside `api/`: one `startPoll` of Open-Meteo every 30 minutes while the clock is real and motion is not reduced (8 s timeout, no credentials, no referrer, at most one call a poll period however often it restarts). The last good reading is kept 3 hours, else the day's seeded weather is used.
- **Easing.** `sim/sky.ts` turns the sun and cloud into `skyNow` (once a page minute) and eases it over 2 s for the renderers. `sim/window-ease.ts` (through `SkyEase.windowLight`) eases the window light `clock/window-light.ts` asks for on the same clock, blinds with a 900 ms and patches with a 600 ms time constant, so both renderers read one `SimView.windowLight`. `SkyEase.glow` fades the lamps' lunch-nap level (`napGlowOf`) with a 500 ms time constant. All three share `sim/ease.ts`, and `sprites/daylight.ts` `lightOf` maps the result to a light row.
- **The street.** The street's weather (`sim/street/weather-fx.ts`) dresses walkers, sends them to shelter and times the lightning. `render2d/street/weather.ts` paints the wet street, fog and rain; `render2d/sky-fx.ts` and `render3d/weather.ts` paint the glass, blinds and flash, both from `sprites/sky-glass.ts`.
- **Shapes and CSP.** The root file `sky-types.ts` holds the shared shapes. The compiled page's CSP allows `connect-src https://api.open-meteo.com` for it; a source run sends no CSP.

**Region packs.** [world/regions/](../../../src/web/scene/world/regions/) holds every value that belongs to a city. `RegionPack` in `index.ts` carries:

- the city and its coordinates, the road layout and its habits;
- the named main street, park and bus stops (proper names, never translated);
- the shop row with each front's hours and what an errand brings back, and the vehicle mix;
- the street hours (rush, school, deliveries, parks, vendors, the crew) and the holiday date tables;
- the landmark's foot and scale, `officeHours`, `officeLife`, the report seasons and the expiry rule;
- the staff who come in on a rest day, and the lobby's wall clocks (each an exchange's code and the zone it reads).

`packOf(homeRegion)` picks one and falls back to the default, so every region the daemon resolves draws a city; only `vn.ts` ships. A new region is one data file plus its id in `RegionPackId` and `REGION_PACKS`. `sim/street/`, `sim/life/crew.ts` and `render2d/street/` hold no name, clock time or shop of their own, and every generic word they show is a `ui.office.street.*` key in both catalogs. The festive tables run to `FESTIVE_LAST_YEAR`; extend them before that year ends.

**The street layer.** `sim/street/` steps the traffic and signals, the pedestrians and errands, the parks, vendors and animals, and the weather on the street (`createStreet`: rebuilt on a day, region or zone change, held still under reduced motion). Its chance comes from the `world/rng.ts` seeds and its time from the clock, so a 2D/3D switch keeps every vehicle, person and animal, and a hidden pane is rebuilt from the clock on return, never replayed.

**Painting.** Only `sim/street/` moves a street entity; the painter only reads. `render2d/street/paint.ts` is the one painter both renderers read: `PAINT_PARTS` (in `parts.ts`) is its ordered list (sky, city, park, shops, frontage, festive, signals, shelters, vendors, movers, weather), and each part paints the static canvas (repainted at most once a page minute, at one of the three detail levels in `detail.ts`) and may paint the moving canvas over the visible rect each step.

- The static repaint keeps its costliest slices (the landmark tower, the skyline and each park) as offscreen layers (`render2d/street/layer-cache.ts`), repainted only when their own key moves (the light, the day, the language, the detail level, and the shadows, which read the sun in whole degrees) and otherwise composed as they stand; the sharp copy paints straight.
- A repaint is never done in one frame: `paint-run.ts` paints its parts onto a scratch canvas a few at a time (`STREET_PAINT_SLICE_MS` a frame, one part past it at most), and copies the finished picture onto the shown canvas, so the shown one is never half painted and the previous detail level or minute stays up, stretched, meanwhile.
- The sharp copy does the same after the static canvas has finished, and a frame that painted leaves the moving canvas to the next.
- The loop keeps drawing frames only until the paint is done (`isCurrent`), a repaint that changes before it ends starts over, and the scratch canvases are freed when one finishes, is replaced or the painter is released.

**Rendering.** The canvases reach the renderers through the sim view: 2D blits them, 3D maps them on two planes (`render3d/street-planes.ts`, uploading a canvas only when its version moved). The street wakes the loop only while something it owns moves inside the visible rect. The LED board reads `data/led.ts`, which folds the page's overview reads into one item per index, with a line of the reads since the page opened.

**The building crew and the lift.** `sim/life/crew.ts` walks the receptionist, the cleaner and the guard by the pack's crew hours, on trading days for the first two. They are not director actors: no status, no menu, no click, skipped by Tab and by the text twin. `sim/lift.ts` is the one car between the two floors: a rider's call lights the floor's button, the car rides there and opens, all stepped with the sim and with no timer of its own; a rider is off both floors while the car moves.

**The sim loop and its clock.** [scene/sim/loop.ts](../../../src/web/scene/sim/loop.ts) runs fixed steps under an accumulator, draws frames only while something moves (people at work or walking at a capped rate; the fidgets, steam and fish ride the ambient clock instead), sleeps on one timeout to the next deadline when nothing moves, and runs nothing in a hidden tab or while its pane is hidden (another pane on a narrow screen). The sim never reads `Date.now()` or `Math.random()`. Time comes from [scene/clock/clock.ts](../../../src/web/scene/clock/clock.ts): real time, or a preview hour running at a chosen speed, wrapped inside the real day so the date and its seeds never move; it is never stored. Chance comes from the keyed seeds of `world/rng.ts`, so the same day looks the same after a reload. Every pool (actors, beats, pets, papers, bubbles) has a cap.

**How an event becomes a goal.** The director reads the live store, not the event stream, so a reconnect cannot duplicate anyone. `goalsFor` in [sim/vocabulary.ts](../../../src/web/scene/sim/vocabulary.ts) turns each focus run's progress key into rows of cast (who, at which kind of prop, in which pose, holding what), the first row whose key is a prefix of the run's progress winning; a run no row matches becomes "at the desk, typing" under the run's name, and a request waiting on you sends its holder to your desk. Goals are `work`, `idle` or `life`, and a `work` goal always carries its `runId`. One-off gestures (a hand-over, a reaction, an arrival, a scored call) are beats subscribed to the hub. The office life ([sim/life/](../../../src/web/scene/sim/life/)) and the team floor ([sim/team/](../../../src/web/scene/sim/team/)) hear the hub only to record; the next step acts. Life goals sit under work goals and are dropped the moment a run needs the person.

**The renderer seam.** [scene/renderer.ts](../../../src/web/scene/renderer.ts) is `SceneRenderer`: `mount`, `unmount`, `draw(view, now)`, `toScreen`, `toWorld` and `stats`. A renderer draws a `SimView` snapshot and never changes sim state; overlays and hit testing speak only `toScreen` and `toWorld`, so they do not know which renderer is mounted. The composer keeps one `RendererHost`, a fixed `SceneRenderer` face the loop and overlays hold, and `swap(next)` calls the old renderer's `unmount()` before the new one's `mount()`. [overlay/scene-views.ts](../../../src/web/scene/overlay/scene-views.ts) runs the 2D | 3D choice: it loads the 3D renderer by `import()` the first time, moves the canvas's input and its screen-reader names onto each new canvas, and returns to 2D, with a line saying so, when the load fails, the mount throws or the graphics context is lost.

**Input, layout and attention.**

- [overlay/interact.ts](../../../src/web/scene/overlay/interact.ts) is the one owner of the canvas's listeners (pointer, wheel, key and focus, on one `AbortController`), with `pointer.ts`, `pinch.ts`, `actor-focus.ts` and `radial-menu.tsx` beside it. It has no timer of its own, so its touch long-press and the follow run on the sim step, and it is detached and attached again on every renderer swap.
- [state/breakpoints.ts](../../../src/web/state/breakpoints.ts) holds the two widths (900 and 600 px) in `matchMedia` queries and writes `data-layout` (`wide`, `narrow` or `phone`) on the document. Every stylesheet selects on that attribute, and `state/pane.ts` says which pane shows below 900 px.
- [ui/keys/keys.ts](../../../src/web/ui/keys/keys.ts) is the one document `keydown` listener for the shortcuts.
- [state/attention.ts](../../../src/web/state/attention.ts) applies the weight the daemon puts on each wire event (bubble brightening, dots, the tab title; the tab icon in `state/favicon.ts`, the chime in `state/chime.ts`, browser notifications in `state/notifications.ts`) without re-deriving it.

**Budgets and `?perf=1`.** [scene/budgets.ts](../../../src/web/scene/budgets.ts) names:

- the frame cost of the 2D renderer, and the render rate allowed for people at work;
- the one ambient clock (`AMBIENT_FX_FPS`, waking the loop only while one of them is on and never under reduced motion). It steps the 2D floor's dust, ribbons, rack, approval light and bubbles, both floors' pet idle moves (breathing, an ear flick, a glance, a wag, the sleeper's blinking "z"), the people's blinking and breathing inside their ambient window, the steam over a mug and the fish;
- the one seeded sequence of ambient windows in [scene/sim/ambient-windows.ts](../../../src/web/scene/sim/ambient-windows.ts) that people's blinking and fidgets, the desk screensavers, the LED strip, the StandBy stands' drifting colour, the pets and the fish all share. A window opens 12 to 60 s after the last closes and lasts 10 to 30 s. Each consumer keeps to its own stretch of it, and a clock that runs only inside that stretch holds the strip, the colour and the screensavers still between windows, so a quiet floor goes fully still;
- the draw calls allowed to a 3D floor;
- one street sim step (`STREET_STEP_BUDGET_MS`) and the longest frame of a repaint of the street's static canvas (`STREET_PAINT_BUDGET_MS`), which a repaint keeps by painting `STREET_PAINT_SLICE_MS` of steps a frame.

With `?perf=1` in the address, the readout in `overlay/perf-readout.tsx` shows each figure against its budget once a second, the street step and the street repaint included.

**Page plumbing for the settings and tabs.** `ui/kit/undo-bar.tsx` `showUndo` is the one undo bar: the shell mounts it once, its window pauses while the page is hidden, a newer bar sends the held call first, and a closed page sends nothing. `?chat=<id>` starts only the chat's reads (`startLive({ chatTab })`) and draws no scene. A route the daemon may hold longer carries `timeout: 'slow'` and waits `slowRequestMs` from `/v1/state` plus a margin (`setSlowRequestMs`). `isAdvanced` in `state/prefs.ts` is the detail level every reader checks.

**Gates and the dev loop.** The page's gates are the repo's gates, widened to `.tsx`: line and function limits, cycles, unused exports, reachability (it follows `index.html` to `main.tsx`), `check-dag`, `check-scene-layers`, and `check-vi-terminology` over the catalog. There is no test suite; verification is the gates plus a manual walk against a copy of your data. The page is bundled once, at the first request, so editing `src/web` needs the daemon restarted to show: `bun --hot` does not rebuild it. `bun run build` compiles the page into the binary with `--splitting`, so `three` sits in a chunk that loads only when the 3D view is chosen (run from source, it is part of the one page bundle), and `./dist/openalpha start` serves it. Run the daemon on a copy of your data (`OPENALPHA_DATA_DIR`) and open the page with `web`.

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
- [src/web/](../../../src/web/), [scripts/check-scene-layers.ts](../../../scripts/check-scene-layers.ts): the office page and its scene-layer gate
- [Extending](./extending.md), [Channels](./channels.md)
