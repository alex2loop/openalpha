# Safety internals: approval gate and errors

For contributors. What operators see is in [Safety](../safety.md).

## Approval gate

The gate sits after input preparation and right before execution (`engine/loop/turn.ts`), so a
blocked call never reaches the executor.

- **Mode.** `ApprovalMode` is `'manual' | 'bypass' | 'unavailable'` (`core/tool.ts`). A run carries
  one. `createApprovalGate` allows on `bypass` before it consults `requiresApproval`, so a tool
  cannot make itself un-bypassable there. A tool whose effect is irreversible outside the process
  reads `approvalMode` off its own context and refuses instead: `order_place` throws
  `order.approval_bypassed` unless `[trading.orders] allow_unattended` is set
  (`trading/features/order/execute.ts`).
- **Danger.** A call is dangerous when the tool's `capability` is `write` or `shell`, when
  `isExternal` is set (MCP server, untrusted plugin), or when `requiresApproval(input, context)` says
  so.
  - `requiresApproval` receives normalised, schema-valid input, so a read-capable tool like
    `schedule` or `memory_store` can gate only its mutations.
  - Its `CallApprovalContext`
    (`engine/hooks/approval-context.ts`) counts this tool's calls in the run and answers `hasSeen`
    against the operator's own words (forwarded `<pasted_content>` removed) and non-error results of
    `net` tools, never text the model wrote.
  - `web_fetch` asks for a URL in neither, for extra headers, and past `[loop] max_unasked_fetches`.
- **Remember.** `oneTimeApproval: true` on a tool offers no remember arm. `order_place` sets it with
  `requiresApproval: () => true`.
- **Decisions.** `decisionsFor(scope, oneTime)` is the one map from scope to offered choices.
  `scheduler` and `delegated` scopes, and any `oneTime` call, get `['deny', 'once']`; `session`
  and `mcp` get all three. Every approval surface (CLI, channels, MCP form, server WS) calls it, so
  no surface shows a button the gate refuses.
- **Key.** `approvalKeyFor(call)` is `<tool>:<sha256 of [command, ...args], unscrubbed>` for `shell`
  tools (no secret kept in clear, and `["a b"]` differs from `["a", "b"]`),
  `<tool>:<sha256 of canonical input>` for external tools, and the tool name for the rest. The
  session manager stores keys per session in process memory only.
- **Dedup.** Identical pending calls in one run share one prompt, keyed
  `<runId>:<tool>:<JSON input>`.
- **Delegation.** `createDelegatedApproval(parentRunId)` builds the child's approval: one-time only,
  never the parent's bypass or remembered keys. A headless child gets `approvalMode: 'unavailable'`
  (`tools/delegation/child-run.ts`).
- **Timeouts.** The wait runs under `[loop].approval_timeout_ms` (120 s) or
  `[schedule].approval_timeout_ms` (900 s) for targeted jobs, and pauses the run-duration deadline.
- **Prompt detail.** `shell_exec` refuses a call whose command and arguments exceed the 400-character
  prompt detail, and quotes arguments holding whitespace or quotes. Argument previews are
  credential-scrubbed and capped at 2,000 characters.

## Errors

Source of truth: [`src/core/errors.ts`](../../../src/core/errors.ts). Errors crossing runtime
boundaries are typed `Error` subclasses with stable codes. Surfaces localise and render them; domain
modules never print errors.

### Hierarchy

```text
Error
`-- AppError
    |-- RunHalted
    |-- LLMError
    |-- ToolError
    |-- ConfigError
    |-- StorageError
    |-- ChannelError
    |-- ValidationError
    |-- ConflictError
    `-- OrderError

ToolError
|-- HttpRequestError        (adds status, retryAfter)
|-- SearchRetryableError    (adds retryAfterMs, failureCode)
`-- SearchProviderError     (adds costUsd, retryAfterMs, failureCode)

ConfigError
`-- OperatorConfigError     (adds a keyed, localised OperatorMessage)
```

`AppError` stores an optional `cause`, sets `name` to the concrete class and requires a `code`.
The `ToolError` subclasses carry a `ToolErrorCode` like any other and add only what a caller needs
to decide a retry: an HTTP status, a backoff, what the provider charged for the failed attempt.

| Class | Code type | Purpose |
|---|---|---|
| `RunHalted` | `HaltCode` | Expected terminal run state; optional `detail` |
| `LLMError` | `LLMErrorCode` | Provider/model attempt failure with usage and fallback metadata |
| `ToolError` | `ToolErrorCode` | Tool lookup, authorisation, validation, execution or safety failure |
| `ConfigError` | `'config'` | Parse, validation or resolution failure; carries a structured `path` |
| `StorageError` | `'storage'` | Persistence boundary failure |
| `ChannelError` | `ChannelErrorCode` | Channel init, polling, send or edit failure |
| `ValidationError` | `'validation'` | Invalid caller input outside the narrower domains |
| `ConflictError` | `'conflict'` | A compare-and-set that lost, or a request identity replayed with different content |
| `OrderError` | `OrderErrorCode` | Exchange auth, submission, fill or ledger-mirror failure on the order path |

`ConflictError` differs from `ValidationError` because the request was well-formed - the caller
raced or replayed - and the two map to different statuses at the wire boundary. The CLI prints its
message without `--verbose`, because it carries the version the operator needs to retry.

A setup failure the operator can fix throws `OperatorConfigError` with a keyed `errors.*` message.

- `toInvalidConfigError(err, schema, section?)` words a schema refusal with every issue as one list
  param (a bounded count, then "and K more").
- An unknown key is one entry per key, offered the nearest name `schema` accepts there
  (`closestName`, `core/utils/text`). It allows a third of the word's length in edits, so a short
  word suggests nothing. An unclaimed top-level section is offered the nearest known section the
  same way.
- A bare `ConfigError` is internal: surfaces print a generic localised line and keep its English for
  `--verbose`. `ConfigError` has one code on purpose; read `path` to name the rejected field.
- `StorageError` also has one code and keeps the underlying cause.

### Order errors

`OrderError` is declared in
[`trading/features/order/types.ts`](../../../src/trading/features/order/types.ts), not `core`:
`core` carries no finance vocabulary, and `AppError` is exported so a domain can name its own
failures. Every code in `OrderErrorCode` sits in one of two groups.

**Operator must act** (the order filled and the book does not know, or protection is missing):
`order.unmirrorable`, `order.unmirrorable_fee`, `order.fee_unreported`, `order.unpriced_fill`, `order.fill_timeout`
(still live at the exchange), `order.exit_failed` (open position, no stop).

`order.fee_unreported` is reached only after Binance's receipt read re-lists the trades a bounded number of
times with backoff (`rereadUntil`, `venues/transport.ts`, abortable); the mirror then logs it at `warn`
(`order.fill_fee_unreported`), since `/record sync` books the fill later. Any other unbookable fill stays
`order.fill_unbookable` at `error`.

**The book is untouched:** `order.auth`, `order.network`, `order.rate_limited`, `order.insufficient`,
`order.rejected`, `order.clock_skew`, `order.below_minimum`, `order.exit_below_minimum`, `order.exit_inverted`,
`order.exit_oversized`, `order.book_moved`, `order.book_unpriced`, `order.sell_unsettled`, `order.sell_guarded`,
`order.no_position`, `order.exit_conflict`, `order.approval_bypassed`, `order.buying_halted`,
`order.unfilled`, `order.exit_not_amendable`, `order.venue_unavailable`, `order.venue_ambiguous`,
`order.venue_unreachable`, `order.quote_not_live`.

`order.exit_unsupported` is in both: the same refusal means nothing moved when `/trade exit` raises
it, and a position open with no stop when it is raised while attaching an exit to a filled entry.

Notes:

- `order.sell_unsettled` and `order.sell_guarded` are the two halves of a sell the book cannot fill
  (quantity not yet delivered; quantity a resting exit froze). They refuse separately because the
  fixes differ, and each carries the sellable quantity as its detail.
- `order.venue_unavailable` and `order.venue_ambiguous` are the routing refusals. Both carry the
  candidate list as the error's detail. `translateToolError(locale, code, detail)`
  (`src/i18n/index.ts`) takes no per-venue parameter, so the catalog sentence names no exchange and
  the venue reaches the operator through the detail.
- `order.venue_unreachable` is not routing: the venue was named and is hand-traded or has no
  credentials.

### Run halt codes

`HALT_SPEC` maps each `HaltCode` to a CLI exit status, message key, optional hint key and emoji.

- `HALT_DETAIL_SPEC` words the halt details that need their own text: the ceiling behind a budget
  halt, and the provider codes that change the operator's next step (`auth`, `billing`, `not_found`,
  `rate`).
- `failureSpecOf(result)` picks the detail's text over the halt code's when the detail has one; the
  CLI words a bare `LLMError` the same way.
- The `auth`, `billing` and `not_found` codes read as a provider's verdict only when the provider sent
  it. `classifyHttpError` marks the error (`answeredByProvider`), and `haltDetailOf` drops the code
  from any other `LLMError` (a sign-in failure, an unknown provider). That error keeps its own
  diagnostic or reads as the broad `llm_error`.
- A `budget` halt carries a `BudgetHaltDetail` (`run_budget`, `daily_cap`, `monthly_cap`,
  `agent_daily_cap`, `ledger_unavailable`); an `llm_error` halt carries the provider's `LLMErrorCode`
  where `haltDetailOf` allows it.
- `RUN_FAILURE_SPEC` maps the broader non-completed run reasons (`aborted`, `budget`, `turn_limit`,
  `loop`, `timeout`, `error`) onto the same entries where semantics match; a typed halt code is
  preferred.

| Code | Exit | Meaning |
|---|---:|---|
| `abort` | 130 | Caller cancellation |
| `budget` | 3 | A cost ceiling reached, or the cost ledger unreadable |
| `rate` | 4 | Rate limit exhausted: the provider's or the in-process limiter's |
| `llm_error` | 5 | Terminal LLM failure |
| `turn_limit` | 6 | Maximum turns reached |
| `length_limit` | 7 | Context cannot be compacted within limits |
| `content_filter` | 8 | Provider or safety policy blocked content |
| `queue_full` | 9 | The chat session's queue rejected new work |
| `no_agents` | 10 | No eligible agent profile |
| `hook_failed` | 11 | A required hook failed |
| `session_busy` | 12 | The session already has a run in progress |
| `loop` | 15 | Repeating tool or assistant behaviour detected |
| `agent_paused` | 16 | The owning agent is paused |
| `shutdown` | 0 | Runtime stopped normally |

### LLM error codes

`LLM_ERROR_CODES` in `core/llm.ts`:

```text
transient, rate, auth, timeout, not_found, context_overflow,
billing, empty_response, output_budget_exhausted, response_too_large, fatal
```

- `rate` is a provider 429. It differs from `transient` because the refused window does not reopen
  inside a retry backoff: the same entry is never re-asked, the chain falls through, and the entry
  cools for the stated `Retry-After`.
- A failure after the stream opened never carries an HTTP status. Each provider reports it as an SSE
  frame in its own words (`error.code`, `error.type`, `event_type: error`). Each transport maps the
  word to the status the same failure would have carried; classification stays in
  `classifyHttpError` (`ai/adapters/errors.ts`). An unlisted word reads as a server fault, which the
  chain fails over on. An unrouted frame would end the stream as a bare empty answer.
- `output_budget_exhausted` is an attempt that stopped at its output cap with nothing to show
  (`finish=length`, no text, no tool call). It differs from `empty_response` because the identical
  call spends the identical budget: never retry the same entry, only another one can help.

`LLMError` can carry provider/model, attempt id, usage and its source, prior attempts, retry delay,
fallback permission and latency. Usage and attempt history are attached by `attachAttemptUsage` and
`attachProviderAttempts`, so paid work stays auditable when an attempt fails.

### Tool error codes

```text
unknown_tool, unauthorized, invalid_input, depth_limit,
delegate_full, budget_exhausted, approval_timeout, approval_denied,
approval_unavailable, unexpected,
path_escape, binary_content, host_blocked, dns_failure, payload_too_large,
schedule_blocked, file_not_found, credential_leak, timeout,
repeated_call, server_unavailable, superseded
```

Tools return expected failures as `ToolResult.isError` where appropriate. A thrown `ToolError` is a
boundary failure the engine must classify.

### Channel error codes

| Code | Meaning |
|---|---|
| `not_initialized` | Adapter used before successful initialisation |
| `get_updates_failed` | Polling or inbound retrieval failed |
| `send_failed` | Outbound send failed |
| `edit_failed` | Editing an existing outbound message failed |

`ChannelError.retryAfterMs` carries a server-provided backoff hint. The caller owns retry policy.

### Helpers

- `abortError(signal)` keeps an `Error` abort reason, else returns `RunHalted('abort', 'aborted')`.
- `assertNotAborted(signal)` throws that when the signal is already aborted.
- `isAbortError(err)` narrows the DOM `AbortError` a signal raises - separate from the domain
  `RunHalted('abort')`.
- `isErrno(error, code)` narrows unknown failures to a Node errno shape.
- `attachAttemptUsage(error, input)` / `attemptUsageOf(error)` attach and read usage on a failed
  LLM attempt.
- `attachProviderAttempts(err, attempts)` records the prior attempts behind a terminal chain failure.
- `markInterruptedVisibleOutput(err)` marks an `LLMError` that failed after emitting visible output,
  so no replay follows.
- `operatorMessageOf(err)` finds the operator wording through the causes a wrapper adds (4 levels).
- `isCallerFault(err)` is true for `ValidationError`, `ConfigError`, `ConflictError`: the operator's
  own request was refused, so advising a retry is pointless.

### Boundary rules

- Throw only typed subclasses from the hierarchy.
- Preserve the original failure through `cause`.
- Never leak credentials, raw provider bodies, paths or stack traces to channel users.
- Do not reimplement exit codes or halt copy in a surface; consume `HALT_SPEC` and i18n.
- Cleanup failures must not mask the original error.

## Source map

- Danger classification: [`engine/hooks/dangerous.ts`](../../../src/engine/hooks/dangerous.ts) - gate: [`engine/hooks/approval.ts`](../../../src/engine/hooks/approval.ts) - key and dedup: [`engine/hooks/approval-manager.ts`](../../../src/engine/hooks/approval-manager.ts)
- Tool contract (`requiresApproval`, `oneTimeApproval`, `ApprovalMode`): [`core/tool.ts`](../../../src/core/tool.ts)
- Execution order: [`engine/loop/turn.ts`](../../../src/engine/loop/turn.ts)
- Prompts: [`cli/commands/chat/approval.ts`](../../../src/cli/commands/chat/approval.ts) - [`cli/commands/mcp/approval.ts`](../../../src/cli/commands/mcp/approval.ts) - [`channels/delivery/callbacks.ts`](../../../src/channels/delivery/callbacks.ts)
- Credentials: [`core/security/credentials.ts`](../../../src/core/security/credentials.ts)
- Paths and permissions: [`core/security/path-policy.ts`](../../../src/core/security/path-policy.ts) - [`core/security/private-files.ts`](../../../src/core/security/private-files.ts)
- Output policy: [`core/security/output-pipeline.ts`](../../../src/core/security/output-pipeline.ts)
- Network: [`core/ssrf/network-policy.ts`](../../../src/core/ssrf/network-policy.ts) - shell: [`tools/shell/policy.ts`](../../../src/tools/shell/policy.ts)
- Plugin trust: [`plugins/policy/trust.ts`](../../../src/plugins/policy/trust.ts) - channel admission: [`channels/delivery/gate.ts`](../../../src/channels/delivery/gate.ts)
- Errors: [`core/errors.ts`](../../../src/core/errors.ts) - [`core/config/operator-errors.ts`](../../../src/core/config/operator-errors.ts) - [`trading/features/order/types.ts`](../../../src/trading/features/order/types.ts)
