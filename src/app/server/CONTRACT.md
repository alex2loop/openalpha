# OpenAlpha `/v1` daemon↔client contract

Normative spec for the control API. **This is the single source of truth** for the daemon
(`src/app/server/`, TypeScript) and every client. The two sides are built **independently** against
this document — neither imports the other.

- **TS types** (canonical, machine-checked): [`wire/`](wire/) — `system.ts`, `config.ts`,
  `sign-in.ts`, `chat.ts`, `events.ts`, `trading.ts`, `market.ts`, `money.ts`, `agents.ts`,
  `errors.ts`, `socket.ts`. Route handlers MUST NOT redefine these shapes.
- **Client mirror**: a client in another language hand-syncs its own types to `wire/`, verified by
  decoding the fixtures below (no daemon needed).
- **Fixtures** (canonical byte-level examples): [`fixtures/`](fixtures/) — one per endpoint + per
  `wire_event` kind + the chat frames. Both sides decode these through their real decoders; a
  malformed or drifted shape fails at decode time. This is the drift check.

> **MUST / SHOULD / MAY** per RFC 2119.

---

## 1. Transport

- **Two surfaces, one server:** **HTTP** for request/response (snapshots + `POST /v1/respond`); **one
  WebSocket** at `GET /v1/ws` for everything realtime (the `wire_event` feed, chat, mid-stream
  steering, and binary dictation audio). No SSE.
- **Bind:** `127.0.0.1` only (loopback). The daemon also verifies the request **peer** is loopback
  (defense in depth). No remote surface, ever.
- **Auth:** `Authorization: Bearer <token>` on every route except `GET /v1/health`. The `/v1/ws`
  **handshake** takes the same bearer header (native `URLSessionWebSocketTask` sets it) **or**, because
  browsers cannot set headers on a WS handshake, a `?token=<token>` query param. Token at
  `${dataDir}/auth/api/token.json` (`~/.openalpha` default; honor `OPENALPHA_DATA_DIR`), chmod `0600`,
  generated on first enable. Compared constant-time.
  The `/v1/ws` handshake also enforces an **Origin allow-list**: a present `Origin` header MUST
  have a loopback hostname (`127.0.0.1`, `localhost`, `[::1]`); native clients send no `Origin`
  and pass. Requests presenting a wrong token, on HTTP and WS alike, count toward the same per-peer
  lockout (5 failures → 30s backoff, doubling to 1h). A request with no credentials is refused
  without counting, and a valid token is never refused by the lockout (it also clears it).
- **Opt-in:** off by default (`[api].enabled = false`). When off, no socket is bound and the daemon is
  byte-for-byte unchanged.
- **Encoding:** JSON, `camelCase` keys, UTF-8. No snake_case on the wire. WS **text** frames are JSON
  (`ServerFrame`/`ClientFrame`, `socket.ts`); WS **binary** frames are raw PCM dictation audio.
- **Base path:** every route is under `/v1`.
- **Concurrency:** the daemon caps concurrent `/v1/ws` sockets; over the cap the handshake is rejected
  with `too_many_streams` (503) before the upgrade. Two handshakes racing for the last seat can both
  pass that check; the loser's socket is closed with WS code 1013 `too_many_streams`. One socket per
  client is the norm.
- **CORS:** the daemon ships no `Access-Control-*` headers, so browsers block cross-origin reads of
  the HTTP endpoints; the WS Origin allow-list above gates the one CORS-exempt protocol.

## 2. Versioning & compatibility

- The path prefix (`/v1`) and `WireEvent.v` (`1`) and `CONTRACT_VERSION` (`1`) move together.
- A shape changes in one go: `wire/*.ts`, the affected `fixtures/*.json` and this doc in the
  **same commit**, with no old field, shim or fallback kept, and every client mirror follows. A
  fixture a client cannot decode is drift.
- **Clients MUST tolerate the unknown:** ignore an unknown `WireEventKind` / `ChatFrame.kind` /
  object key rather than erroring, so an app one build behind keeps working.
- `CONTRACT_VERSION` bumps when a change would make an older app misread an answer.

## 3. REST endpoints

| Method | Path | Auth | Request | 2xx response | Fixture |
|---|---|---|---|---|---|
| GET | `/v1/health` | no | — | `HealthResponse` | `health.json` |
| GET | `/v1/state` | yes | — | `StatePayload` | `state.json` |
| GET | `/v1/live` | yes | — | `LiveSnapshotWire` (`runs`: every agent run and long-running command still running, oldest first, each with its latest `progress`, `thinking` and the `persistent` steps so far; `pending`: every approval and question still waiting on any channel, approvals first, each oldest first; an approval is `{kind:'approval',event,channelId,answerable}` where `event` is its `approval_requested` wire event, a question is `{kind:'question',requestId,runId,sessionId,channel,question,askedAt,answerable}`; `answerable` is true only for a request asked on `api`; an approval leaves on `approval_resolved` or its `expiresAt`, a question on the next agent run in its `sessionId` or after a day; `alertsCheckedAt`: epoch ms the last alert pass finished, absent before the first) | `live.json` |
| GET | `/v1/doctor` | yes | — | `DoctorReport` | `doctor.json` |
| GET | `/v1/commands` | yes | — | `CommandList` | `commands.json` |
| GET | `/v1/update` | yes | — | `UpdateResponse` (`enabled` false when checks are off or the daemon runs from a source checkout; the release feed is read once a day; `latest` is the newest release whether or not it is newer than `current`) | `update.json` |
| GET | `/v1/cost` | yes | `?from&to` (`YYYY-MM-DD`, both required, at most 366 days) | `CostReport` (`caps.warnRatio`: the share of a cap at which the daemon warns; each row's `billingAgentId` is the agent whose own daily cap the spend counted against, `agentId` the one that ran it) | `cost.json` |
| GET | `/v1/agents` | yes | — | `AgentsResponse` (the operator's own agents only: `paused`, `maxDailyUsd?`, `spentTodayUsd`, `focusKey`, `focusLabel`, and once it has called: `record` of every focus it has used together, `agreement?` and `contrarian?` against the other agents, `overlapsWith`, and `social`: `[{network, state, reviewAll, drafts}]`, empty when the agent is on no social network) | `agents.json` |
| POST | `/v1/agents/:id/pause`, `/v1/agents/:id/resume` | yes | — | `{ "ok": true }` (an id that is not one of the operator's own agents is `not_found`; a paused agent refuses every run it owns until resumed) | — |
| GET · POST | `/v1/pairing` | yes | `PairingDecisionBody` (POST) | `PairingList` / `PairingDecisionResult` | `pairing.json` |
| POST | `/v1/respond` | yes | `RespondBody` | `{ "ok": true }` | `respond.approval.json` |
| GET · POST | `/v1/config`, `/v1/config/validate` | yes | raw config (POST) | config / validation / write result | — |
| GET | `/v1/providers` | yes | — | provider catalog | — |
| POST | `/v1/providers/test` | yes | `{}` | `ProviderTestResult` (`{ok, model}` or `{ok:false, code}`) | — |
| GET · POST · DELETE | `/v1/auth/chatgpt` | yes | `{ method: 'browser' \| 'device' }` (POST) | `ChatgptAuthStatus` | `chatgpt.json`, `chatgpt.login.json` |
| GET | `/v1/chat/recent`, `/v1/chat/history/:sessionId` | yes | `?limit&before` (history; `limit` defaults to 30 and runs 1 to the session message cap, anything else is `invalid_body`; `before` is a transcript index (`idx`) and returns the rows older than it, a non-numeric or oversized value is ignored; `nextBefore` is the oldest returned row's `idx`; a page whose messages all render empty is possible, so keep paging while `hasMore`) | session id / message page | — |
| POST | `/v1/mcp` | yes | MCP JSON-RPC | MCP result (tools only) | — |
| GET | `/v1/quotes` | yes | — | `TradingQuotesResponse` | `quotes.json` |
| GET | `/v1/ohlcv` | yes | `?market&ticker&fromDay&toDay` (all required) | `TradingOhlcvResponse` | `ohlcv.json` |
| GET | `/v1/events` | yes | `?market&ticker&fromDay&toDay` (all required) | `TradingEventsResponse` (ex-dates, meetings, splits, listings; `title` and `detail` are the source's own words; a market no event source covers answers an empty list) | `events.json` |
| GET | `/v1/news` | yes | `?region&limit` (optional) | `TradingNewsResponse` | `news.json` |
| GET | `/v1/profile` | yes | — | `TradingProfileResponse` | `profile.json` |
| POST | `/v1/profile` | yes | `{ patch }` | `TradingProfileResponse` | `profile.json` |
| GET | `/v1/portfolio` | yes | — | `TradingPortfolioResponse` (`unitCostNative`: the buy price in the market's own currency, fees included) | `portfolio.json` |
| GET | `/v1/portfolio/nav` | yes | `?window=1m\|3m\|6m\|1y\|all` (default `3m`) | `TradingNavResponse` (`index` is time-weighted from 1; `periodReturn`, the drawdowns and leg `weight`s are fractions; `recordedCount` counts every snapshot kept, not the window's; `benchmark` is the operator's target mix with cash at 0, and when it is absent `benchmarkGap` says why: `unbenchmarked` when no target segment has a benchmark, `short-history` when a leg's closes do not span the window) | `portfolio-nav.json` |
| GET | `/v1/suggestions` | yes | `?status` (required: `open` each name's standing verdict, `ended` the scored closes newest close first, `all` every row newest first) `&market&ticker` (both or neither) `&focus` (a `focusKey`; `default`, the operator's own, when omitted; a key no agent has called under is `invalid_body`) `&cursor&limit` | `TradingSuggestionsResponse` (a hold carries `undecided: true` when it records a failed run, not a decision; `trailingStop` and `raisedStopFrom` say where the plan's stop rose to) | `suggestions.json` |
| GET | `/v1/suggestions/:id/card` | yes | — | `SuggestionCardResponse` (`card`: the decision card in the daemon's words, `null` for an unknown id; a malformed id is a 400) | `suggestions.card.json` |
| GET | `/v1/track-record` | yes | `?limit` (optional) | `TradingTrackRecordResponse` (`text`: `/reflect`'s own lines; `acted`: the calls you took against the ones you passed) | `track-record.json` |
| GET | `/v1/brief` | yes | `?region` (optional) | `TradingBriefResponse` (`text`: the brief as the CLI prints it, without icons or indents; each section has a unique `id` and, for a market's, the market's name; `caveats`: the lines the CLI prints once at the end; the cost and the macro reference are not sections) | `brief.json`, `brief.empty.json` |
| PATCH | `/v1/brief` | yes | `{ sendTime: "HH:mm" }` (the market's timezone) | `BriefScheduleWire` (the delivery address is kept; 400 on a malformed time or a refused one, 409 when the brief is off and while it is being delivered, with the daemon's sentence as `message`) | `state.json` (`brief`) |
| GET | `/v1/screen` | yes | `?market` (required) `&kind&limit` | `ScreenResponse` | `screen.json` |
| GET | `/v1/instruments` | yes | `?q` (required, at most 40 chars) `&limit` | `InstrumentSearchResponse` | `instruments.json` |
| GET | `/v1/overview` | yes | — | `OverviewResponse` (the home region's markets first) | `overview.json` |
| GET | `/v1/markets` | yes | — | `MarketsResponse` (`homeRegion`; per market: price convention, region, `ownsRegion`, segment, names in the daemon's language, benchmark, and whether it has a board, a brief and events) | `markets.json` |
| GET | `/v1/macro` | yes | `?region` (optional) | `MacroResponse` (`readAt`: when the sources were read; `lean`: the CLI's one-sentence lean; `scoreRange`: the score's scale and the regime cuts; each driver has its `label`) | `macro.json`, `macro.unavailable.json` |
| GET | `/v1/ledger` | yes | `?limit&cursor&fromDay&toDay` (optional) `&market&ticker` (both or neither: one name's rows) | `LedgerPageResponse` | `ledger.json` |
| POST | `/v1/ledger` | yes | `{ draft, typedPrice? }` + `Idempotency-Key` header (required) | `LedgerWriteResponse` | `ledger.write.json` |
| PATCH · DELETE | `/v1/ledger/:id` | yes | `{ draft, typedPrice? }` (PATCH, the whole row) | `LedgerWriteResponse` | — |
| GET | `/v1/stops` | yes | — | `StopsResponse` (`price`: the mark `distanceToStopPct` was measured from, absent when unpriced; `review`: a fund's lower level is a review, not a sale; `cover`: `placed` / `venue` / `none` stop order at the exchange, absent where none could rest) | `stops.json` |
| GET | `/v1/venues` | yes | — | `VenuesResponse` (every venue a trade can be recorded at and the markets it holds) | `venues.json` |
| GET | `/v1/rebalance` | yes | — | `RebalanceResponse` (`text`: the CLI's lines for this plan; the numbers beside them are for prefilling a ledger row) | `rebalance.json`, `rebalance.unavailable.json` |
| GET | `/v1/reconcile` | yes | — | `ReconcileResponse` (`text`: the CLI's `matched` and `cashNote` sentences, each `null` where it would not be true) | `reconcile.json` |
| GET · POST | `/v1/alerts` | yes | `?limit&cursor` (GET); `AlertCreateBody` (POST) | `AlertsResponse` (`activeCount`: active alerts in all, not on the page) / `AlertWire` | `alerts.json` |
| DELETE | `/v1/alerts/:id` | yes | — | `AlertDisableResponse` | — |
| GET | `/v1/trade` | yes (`orders`) | — | `TradeStatusResponse` | `trade.json` |
| POST | `/v1/trade/staged/:token/confirm` | yes (`orders`) | — | `ConfirmOrderResponse` | `trade.confirm.json` |
| DELETE | `/v1/trade/staged/:token` | yes (`orders`) | — | `TradeActionResponse` | — |
| POST · DELETE | `/v1/trade/exits` | yes (`orders`) | `SetExitBody` (POST) + optional `Idempotency-Key` header; `?ticker&venue` (DELETE) | `ExitResponse` / `TradeActionResponse` | — |
| POST | `/v1/trade/halt` | yes (`orders`) | `HaltBody` | `TradeActionResponse` | — |
| POST | `/v1/trade/reconcile` | yes (`orders`) | — | `ReconcileOrdersResponse` (`orphanExits`: exits resting at a venue that no row tracks, listed and never cancelled; `unreadExitVenues`: venues whose exits could not be listed, so an empty `orphanExits` says nothing about them) | — |
| DELETE | `/v1/trade/unmirrored/:token` | yes (`orders`) | — | `TradeActionResponse` | — |
| GET | `/v1/ws` | yes (header or `?token=`) | WebSocket upgrade | 101 → §4 (feed) + §5 (chat) | `wire_event.*.json`, `chat.*.json` |

The trading shapes are in `wire/trading.ts`. The realtime feed and chat are **not** HTTP routes —
they are messages on the single `/v1/ws` socket (§4, §5). The `wire_event.*.json` / `chat.*.json`
fixtures are the **payloads**; on the socket each is wrapped in its `ServerFrame` envelope
(`{ type, ...payload }`, `socket.ts`). Notes:
- **Units.** `changePct`, `weightPctNav` and every `*PctNav` / `*Pct` in `money.ts` are percents
  (1.5 = 1.5%). `winRate`, every `*ReturnPct`, `shortfallPct` and `sizePctNav` are fractions
  (0.015 = 1.5%), and so is every share in a rebalance finding's `data`.
- **Ledger writes.** A repeated `Idempotency-Key` with the same draft returns the first write;
  with a different draft it is a 409.
- **Typed prices.** A ledger write or `AlertCreateBody` may carry `typedPrice`. `unconfirmed` refuses
  a price ten times or more from the name's latest price with `price_unconfirmed` (422): the
  question in `message`, and the figures in `unconfirmedPrice` to word it in the app's own format.
  Ask the operator, then send the same request with `confirmed`. Absent, the price is not checked.
- **`/v1/state` timeZone.** The IANA zone the daemon counts its days in (the cost caps, `/v1/cost`
  days, suggestion days). A client computes "today" in it, not in its own zone: the daemon may run
  on a server elsewhere.
- **`/v1/state` locale.** The daemon's `[locale] language`: the language `progress.text`, notices and
  every other daemon-written line arrive in, so the app renders its own copy in the same one.
- **`/v1/state` brief.** `brief` is the morning brief's delivery (`state` scheduled, delivering or
  disabled; `channel`; `sendTime` HH:mm in the market's timezone; `nextDeliveryDay`). It is absent
  when the brief was never enabled or trading is off, and a failed read of it leaves it absent
  rather than failing the state.
- **Screen `edge`.** Each screen factor's `edge` is its score above (+) or below (-) the board's
  median; a row's factors are sorted by its size.
- **Position `heldSince`.** The day of the first buy since the position last opened from flat, so a
  chart can set the time before it apart from the time it has been held.
- **Absent, not zero.** An unpriced position has no `marketValueBase`, `unrealizedPnlBase` or
  `weightPctNav`, and the book then has no `navBase`. While the book holds USDT, `navBase` is its cash plus its
  positions plus the USDT's move over its cost; the wire carries no field for that move. A quote with
  no day change has no `changePct`. A client shows these as missing, never as 0.
- **`/v1/quotes`** returns the **profile-resolved** pulse board; each quote names its own
  `market` and `ticker`, the pair `/v1/ohlcv` takes. `closedOn` is the session a settled close
  belongs to; a live reading has none. `staleAt` dates a price too old to be live from a session
  still trading, which is neither.
- **`/v1/respond`** answers one approval: `{ requestId, decision }`, where `requestId` is the
  `WireEvent.requestId` the client received (= the gate's `callId`). A clarification is not
  answered here: its answer is the next chat message in its session (see §4). An approval asked on another channel answers `409 conflict` with `error.message` naming that channel; it is answered there.
- **`/v1/profile` POST** applies a partial patch: keys left out keep their value, and a
  `horizons` map changes only the markets it names.
- **`preferredLocale`** in a profile response is `[locale] language`, the one language every reply
  uses; the profile has none of its own, so it is not a patch key.
- **`/v1/providers/test`** makes one tiny call through the primary model. `code` is the provider's
  error class (`auth` = key refused, `billing` = no credit, `rate`, `timeout`, `not_found`).
- **Before a daemon exists**, the app runs `openalpha setup catalog` (the provider list as
  `SetupResult`) and `openalpha setup write <provider> <model>` (the starter config) with the
  bundled binary; both print one JSON line.
- **`/v1/brief`** answers `{ "snapshot": null }` before the first brief is stored. A section is
  `ready`, `unavailable` (could not be built — worth telling the user) or `omitted-by-policy`
  (turned off — say nothing). A market's section names its `market` and the session `asOf`. `text.story` holds the look back and
  the market story as plain lines, empty when the brief tells none; the snapshot's `sections` may
  hold the two kinds `thesis-review` and `story`, whose rows are copied generically. A
  `screen-delta` section's rows are typed `{ ticker, direction: 'entered' | 'left' }`: the names
  that joined or left the ranked board since the session before.
- **Orders (`/v1/trade`)** answer only with the `orders` capability: a venue with keys that can
  place orders (crypto exchanges); otherwise 503. An order is staged in chat (`/trade spot …`) or
  by the agent, and confirmed here. The token is the idempotency key and is spent by the claim, so a
  retried confirm answers `unknown-token` and places nothing. A confirm runs to the end even when
  the client hangs up (it may wait about 20 s for a fill); a 504 does not mean nothing was placed,
  so read `GET /v1/trade` before staging again. A refusal at the exchange is a 400 with the
  daemon's sentence as `message`. `rejected`: a cap refused the re-priced order and the token is
  spent. Halting stops buys only; sells, exits and cancels still go out.
  `POST /v1/trade/exits` seeds the exchange's client id from `Idempotency-Key`: a retry with the
  same key finds the exit the first call placed instead of resting a second; a call without the
  header is its own request, and a blank or over-200-character key is a 400.
- **Capabilities**: `HealthResponse.capabilities` + `StatePayload.capabilities` tell the client which
  optional sections exist (a flag is true exactly when its route is registered); the client greys unbuilt
  tabs rather than inferring from a 404.
- **`/v1/health` readiness**: an optional `status` (`starting` | `ready`). The daemon binds the socket
  early and answers `starting` (`ok:false`) until its subsystems are up, so a booting daemon is
  distinguishable from a stopped one — the client shows "Starting…" + retries rather than "stopped".
  `contractVersion` is the `/v1/ws` contract it speaks (the `hello` handshake's number), so a client
  can tell a daemon too old for it before opening the socket.
- **`/v1/state` degraded**: what the daemon started without, one entry per item, worded in the
  daemon's language: `channel` (a chat channel left down, `subject` its id), `api`, `key` (an unset
  key variable or an exchange with no keys, with what waits for it) and `optional-key` (a feature with
  a keyless fallback). Empty when everything is configured. It names variables, never their values,
  and sits behind auth rather than on `/v1/health` for that reason. The client shows each `message`
  as is.

## 4. `/v1/ws` — the proactive event feed

The daemon pushes one normalized event type, **`WireEvent`** (`events.ts`), as a `ServerFrame`
`{ type: 'wire_event', ...WireEvent }` (`socket.ts`) on the socket — for the connection's whole
lifetime, regardless of chat activity. The daemon assigns `weight` (routing tier) and stamps `source`
(`channel` + `agentId`) — the client never re-derives either. A `wire_event` carries **one payload
field matching its `kind`**, and the notices also carry `note`, the line a chat would get:

| `kind` | payload field | meaning |
|---|---|---|
| `run_started` | `run` `{kind,name,title?,channel,sessionId,parentRunId?,hidden?,startedAt}` | an agent run or a long-running slash command began; `channel` is the raw channel id (open, never folded into `Channel`), `name` the agent id or the command name, `sessionId` lets a client clear a pending question when the answer turn starts |
| `run_progress` | `progress` `{key,params?,text,mode,at}` | a run's step line, `text` already written in the daemon's language; `params` are credential-scrubbed; `mode` is `transient` or `persistent` |
| `run_thinking` | `thinking` | a scrubbed tail of the model's reasoning, at most one per 2 s per run |
| `run_finished` | `outcome` | run lifecycle end: a run result reason (`completed`, `aborted`, `budget`, `error`, `turn_limit`, `loop`, `timeout`), or `done` / `cancelled` / `failed` for a command |
| `usage` | `usage` `{costUsd,tokens}` | per-run cost/tokens tick |
| `tool_result` | `tool` `{name,ok}` | a tool finished (afterTool) |
| `approval_requested` | `approval` `{toolName,label,argsSummary,expiresAt,decisions,dangerous?,truncated?,channelId?,answerable?,askedAt?}` + `requestId` | tool-gate decision needed from any channel; offer only `decisions`, and only when `answerable` (`channelId` is the raw channel that asked; any other channel answers it there). `label` is the tool's name in the operator's language; `expiresAt` (epoch ms) is when the gate denies on its own |
| `approval_resolved` | `resolution` `{decision,by}` + `requestId` | answered elsewhere / timeout → clear card |
| `clarification_requested` | `clarification` `{text,sessionId,askedAt?,channelId?,answerable?}` + `requestId` + `runId` | agent asks; the answer is the next chat message in `sessionId`, on the surface in `channelId` (the raw channel id) |
| `budget_warning` | `budget` `{period,spent,cap}` | non-interactive heads-up |
| `budget_exhausted` | `budget` `{period,spent,cap}` + `note` | settled spend reached the daily or monthly cap, so paid work is refused until it resets; once per period, and not when a single call's estimate alone would cross a cap (interrupt, `wake`) |
| `provider_fallback` | `fallback` `{from,to,reason,attempt}` | provider fell back; `reason` is the LLM error code |
| `pairing_requested` | `pairing` `{channel,chatId,code,expiresAt}` | a chat was sent a pairing code; answer with `POST /v1/pairing` (interrupt) |
| `alert_fired` | `alert` `{alertId,instrument,condition,threshold,observedPrice,level?}` + `note` | a price alert crossed; `level: target` on a plan's take-profit |
| `stop_breached` | `alert` (with `level: stop`) + `note` | a held name crossed its plan stop (interrupt) |
| `brief_ready` | `brief` `{snapshotId,day}` + `note` | the morning brief is ready; read `GET /v1/brief` |
| `mover` | `mover` `{instrument,condition,observedPrice,movePct?,benchmark?}` + `note` | a watched or held name moved past its usual range |
| `order_filled` | `fill` `{instrument,venue,side,quantity,price,closeReason?}` + `note` | a fill the ledger now holds, from `/trade` or a resting exit (`closeReason` `stop` or `target` on a sale a resting leg made); the one event for a fill, so a chat's exit notice is not repeated as another kind (nudge, `wake`) |
| `alerts_checked` | `checkedAt` | one alert pass finished (about every minute); a pass reads one cursor page of alerts, not the whole book; `GET /v1/live` keeps the last as `alertsCheckedAt` (quiet) |
| `idea` | `idea` `{suggestionId,instrument,action,conviction}` | a buy or reduce was stored (checked each minute); read `GET /v1/suggestions` |
| `schedule_result` | `note` | a scheduled job's or heartbeat's result (sneak) |
| `notice` | `note` | any other daemon notice, as text (nudge) |

- **The app is a delivery address.** While the api runs, the daemon delivers alerts, stop hits,
  the brief and movers addressed to channel `api` straight to the open sockets, and to `api` too
  when no chat channel is attached. What a chat channel accepted is also sent to the open sockets
  once, as the same event, so the page sees what the chat saw. A socket whose send was dropped (closed, or its buffer full) does
  not count as reached: with no socket taking the frame the delivery fails and the daemon retries
  later, as it would for an offline chat.

- **`wake`** is `true` on `approval_requested`, `stop_breached`, `alert_fired`, `order_filled` and `budget_exhausted`
  and absent on every other kind: the events worth bringing a sleeping client back for.
- **`weight`** ∈ `interrupt | nudge | sneak | quiet` — a hint; each client maps it to its own surface
  (a system notification, a toast, a badge). The hint is shared, the rendering is not.
- **`source.channel`** ∈ `Channel` = `cli | telegram | cron | api`. (The scheduler surface is **`cron`**,
  not `"scheduler"`.)
- **Liveness:** the WS layer (Bun) sends automatic protocol pings and reaps an idle peer; there is **no
  application-level heartbeat frame** to ignore. Sockets close on daemon
  shutdown; clients reconnect with backoff.

## 5. `/v1/ws` — chat (bidirectional)

Chat runs on the **same socket** as the feed. The client sends `ClientFrame`s (`socket.ts`):

- `{ type: 'chat', message, sessionId? }` — start a turn. A `message` whose first non-space char is `/`
  runs the shared **slash dispatcher** (channel surface) instead of an agent run.
- `{ type: 'steer', message, sessionId? }` — add a message to the turn already running; it reads it
  at its next turn boundary and the daemon answers `{ kind: 'steered' }`. A turn that already
  ended, or ends before reading it, answers `{ kind: 'steer_dropped', text }` with the CLI's
  sentence asking to send it again; the message is never run on its own. A `/` command is not
  steered: it runs as `chat`.
- `{ type: 'cancel', sessionId }` — interrupt the current turn.
- `{ type: 'hello', contractVersion }` — the handshake; the daemon answers `{ type: 'welcome',
  contractVersion }`, or closes with 1011 when the version differs. A frame that is not one of
  these shapes closes the socket with 1002 `invalid_frame`.
- **binary frame** (not JSON) — ignored: dictation is transcribed on the device and sent as text.

The daemon replies with `ServerFrame`s tagged `type: 'chat'`:

- `{ type: 'chat', ...ChatFrame }` (`chat.ts`): `text` / `reasoning` deltas, `tool` (run→ok/error),
  `usage` footer, `subagent` activity. Scrubbing + tool-display + usage formatting are **daemon-side**;
  the client only renders.
- `{ type: 'chat', kind: 'progress', text }` — a long slash command's current step in the operator's
  words; each replaces the last, and the turn ends with `done`.
- `{ type: 'chat', kind: 'done', reason, haltCode?, haltDetail? }` — turn finished (`reason: 'slash'` when dispatcher-handled). A halted run adds `haltCode` (`budget`, ...) and, when the halt has one, `haltDetail`: a budget ceiling (`run_budget`, `daily_cap`, `monthly_cap`, `agent_daily_cap`, `ledger_unavailable`) or a provider error code on an `llm_error` halt, so an app can say which ceiling or failure stopped it.
- `{ type: 'chat', kind: 'error', code, message }` — turn failed. `code` is an `ApiErrorCode` (section 6);
  `message` is a sentence in the daemon's language, never the error's own text.

A `chat` sent while a turn runs waits behind it (`queued`); a `cancel` or a disconnect aborts the
running turn. Shutdown starts by closing admission: no new connection, no new HTTP request, and a
`chat` or `steer` frame on an open socket is answered with `{ type: 'chat', kind: 'error', code:
'unavailable' }`; requests already running finish. A run already going still settles in the drain
window, and the sockets close after it.

## 6. Errors

Every non-2xx response body is **`ApiError`** = `{ "error": { "code": ApiErrorCode, "message"? } }` — a
stable code, never a leaked internal message. `message` is set only when the runtime refused with a
sentence written for the operator (a ledger row the book cannot hold, say), in the daemon's
language; show it as is. Codes and statuses are `wire/errors.ts` (`API_ERROR_STATUS`):
`unauthorized`(401) `forbidden`(403) `not_found`(404) `invalid_json`/`invalid_body`(400)
`conflict`(409) `price_unconfirmed`(422) `upstream_failed`(502) `too_many_streams`/`unavailable`(503) `timeout`(504)
`internal`(500). `price_unconfirmed` also carries `unconfirmedPrice` (`UnconfirmedPriceWire`): the
typed price, the market's latest price and the day it stands for. Fixtures: `error.unauthorized.json`,
`error.price-unconfirmed.json`.

## 7. Independent-development workflow

1. **Daemon team** implements against `wire/` (import the types; never redefine) and
   verifies handlers with `curl` + by emitting the fixtures.
2. **Client team** mirrors the shapes in its own types and checks that every fixture decodes
   through them.
3. **Either side** changing a shape edits `wire/*.ts` + this doc + the fixture together; the other side
   sees a failing decode (or a typecheck error, for TS) and updates its mirror. The fixture diff is the
   hand-off.
