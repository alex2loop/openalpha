# OpenAlpha `/v1` daemon↔client contract

Normative spec for the control API. **This is the single source of truth** for the daemon
(`src/app/server/`, TypeScript) and every client. The two sides are built **independently** against
this document — neither imports the other.

- **TS types** (canonical, machine-checked): [`wire/`](wire/) — `system.ts`, `config.ts`,
  `sign-in.ts`, `chat.ts`, `events.ts`, `live.ts`, `activity.ts`, `notices.ts`, `trading.ts`, `track-record.ts`, `debate.ts`, `digest.ts`, `market.ts`, `money.ts`,
  `orders.ts`, `agents.ts`, `jobs.ts`, `tasks.ts`, `models.ts`, `outbound.ts`, `watchlist.ts`, `portfolio-shares.ts`,
  `errors.ts`, `socket.ts`, `exec.ts`, `vocab.ts`. Route handlers MUST NOT redefine
  these shapes. The folder is self-contained: a file in it imports only its siblings and
  `core/types`, so a client can compile it alone (`scripts/check-dag.ts` enforces this), and
  `vocab.ts` holds the closed vocabularies written out, checked against the daemon's own.
- **Client mirror**: a client in another language hand-syncs its own types to `wire/`, verified by
  decoding the fixtures below (no daemon needed).
- **Fixtures** (canonical byte-level examples): [`fixtures/`](fixtures/) — one per endpoint, one
  sample per feed kind (`event.samples.json`), the chat frames and the exec frames. Both sides decode these through their real decoders; a
  malformed or drifted shape fails at decode time. This is the drift check.

> **MUST / SHOULD / MAY** per RFC 2119.

---

## 1. Transport

- **Two surfaces, one server:** **HTTP** for request/response (snapshots + `POST /v1/respond`); a
  **WebSocket** at `GET /v1/ws` for everything realtime (the `wire_event` feed, chat, mid-stream
  steering, and binary dictation audio). A second WebSocket, `GET /v1/exec`, runs one CLI command
  in the daemon for the operator's own terminal; it admits only a loopback peer with the bearer
  token, no `Origin` and no proxy header (section 6). No SSE.
- **Bind:** `127.0.0.1` only (loopback). The `/v1` HTTP routes also verify the request **peer** is
  loopback (defense in depth); `GET /`, its chunks and the `/v1/ws` handshake are answered before
  that check, so the bind alone guards them (the handshake adds the Origin allow-list below). A
  reverse proxy may front the daemon only with `[api] public_url` set to its `https` address.
- **Host:** every request MUST carry a `Host` whose hostname is `127.0.0.1`, `localhost` or `[::1]`
  (any port, so an SSH tunnel's local port passes), or the host of `[api] public_url` (compared
  without case, default port dropped); any other is `403 forbidden`, which stops a DNS-rebinding
  page. While `public_url` is unset, a request carrying `X-Forwarded-For` or `Forwarded` is
  `403 forbidden` with a `message` naming `public_url`. A compiled binary serves `GET /` and its
  chunks behind these checks; a source run (`bun run`) serves the page through Bun's `routes`,
  which answer before them (the page holds no data). A `/v1` request with
  `Sec-Fetch-Site: cross-site` is `403 forbidden`; native clients send no `Sec-Fetch-Site` and pass.
  The **page origin** is `http://` plus the request's `Host` on loopback, or `public_url`.
- **Auth:** `Authorization: Bearer <token>` or the browser session cookie on every route except
  `GET /v1/health`, `POST /v1/session` and `GET /`. `GET /` serves the office page and its
  content-hashed chunks, unauthenticated: they hold no data, and the page signs in before it reads
  any `/v1` route. In the compiled binary the page and its chunks answer with
  `Content-Security-Policy` (`default-src 'none'`, `'self'` for scripts, styles, fonts and
  connections, plus `https://api.open-meteo.com` for the page's own weather reading,
  `data:`/`blob:` images, `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'`),
  `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`; a source run serves it through Bun's `routes`, which carry none, and the page's own frame guard
  (it renders nothing inside a frame) covers both. Token at
  `${dataDir}/auth/api/token.json` (`~/.openalpha` default; honor `OPENALPHA_DATA_DIR`), chmod
  `0600`, generated on first enable. Compared constant-time. When a request carries a
  `Bearer` `Authorization`, the cookie is not read; any other scheme (a proxy's basic auth) is ignored.
  - **Session cookie:** `oa_session_<port>` on loopback (so a local daemon and a tunnelled one on
    another port keep separate cookies), `__Host-oa_session` through `public_url` (so a sibling
    subdomain cannot plant one); `HttpOnly`, `SameSite=Strict`, `Path=/`, no `Domain`, `Secure`
    through `public_url`. A session ends after 30 days
    unused; each use renews it, and the cookie is sent again with a fresh `Max-Age` (at most once
    an hour). On HTTP the cookie counts only on a request with `Sec-Fetch-Site: same-origin`, and
    a write (any method but `GET`/`HEAD`) also needs `Origin` equal to the page origin; the `/v1/ws`
    handshake counts it on `Origin` equal to the page origin alone. The daemon keeps only a hash of the cookie keyed by the token, so a token change
    (`api rotate`, a new `token_env` value) ends every session at the restart. Signing out and
    `DELETE /v1/sessions/:id` close that session's sockets with WS code 4401 `signed_out`, a socket
    whose handshake was under way at that moment included.
  - **WebSocket:** the `/v1/ws` handshake takes the bearer header (native `URLSessionWebSocketTask`
    sets it) or the session cookie; there is no query-string token. It also enforces an **Origin
    allow-list**: a present `Origin` header MUST equal the page origin, so only the page the daemon
    served opens the socket and another local web app is refused; native clients send no `Origin`
    and pass.
  - **Lockout:** a wrong token (HTTP and WS alike) and a wrong or used sign-in code count toward
    the same per-peer lockout (5 failures → 30s backoff, doubling to 1h). A request with no
    credentials or an unknown cookie is refused without counting. A valid token, code or session is
    never refused by the lockout; a valid token or code also clears it, a session does not.
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
| GET | `/v1/state` | yes | — | `StatePayload` (`schedules`: one row per job; a job that runs when an alert fires carries `event: {event,market?,ticker?,condition?,threshold?,cooldownMs}` and has neither `schedule` nor `nextRunAt`, because it has no time of its own; `restartable`: the daemon runs in the background, so `POST /v1/restart` can restart it, false in a terminal or under a service; `restartIdleWaitMs`: the longest a `when: 'idle'` restart waits for the daemon to go quiet; `restartDrainMs`: the grace runs in flight get when the daemon stops, before they are cut; not the downtime, which also covers the rest of the shutdown and the boot, so a page detects a restart as `/v1/health` going down, then up with a new `pid` in `/v1/state`; `trackRecordMinSample`: resolved calls a track record needs before its rates mean anything, the daemon's own number for a page to gate on; `childRunMaxMs`: the longest one child agent a `spawn` call started may run, the tighter of `[loop]`'s run and spawn caps; `firstRun`: `{modelReady, profileSaved, bookEmpty}` for a first-run checklist: `modelReady` when any configured model passes the check `doctor` runs on it (key set or login done) or the connected client answers every call, `profileSaved` when the operator ever saved a profile (a daemon that never did runs on seeded defaults), `bookEmpty` when the ledger holds no row; `slowRequestMs`: the longest the daemon lets its slow routes run, so a client waits that long plus its own margin for them; `exposed`: `[api] public_url` is set as booted, so a page hides the key fields and shows the server commands; the daemon refuses those writes anyway, a `public_url` saved but not booted included) | `state.json` |
| GET | `/v1/live` | yes | — | `LiveSnapshotWire` (`runs`: every agent run and long-running command still running, oldest first, each with its latest `progress`, `thinking`, the `persistent` steps so far and the `tickers` its progress lines named so far (deduped, first seen first, at most 20; absent when none); `pending`: every approval and question still waiting on any channel, approvals first, each oldest first; an approval is `{kind:'approval',event}` where `event` is its `approval_requested` wire event (its `approval` carries the `channelId` and `answerable`), a question is `{kind:'question',requestId,runId,sessionId,channelId,question,askedAt,answerable}`; `answerable` is true only for a request asked on `api`; an approval leaves on `approval_resolved`, its `expiresAt` or when its run is gone, a question on the next `run_started` of `run.kind` `agent` in its `sessionId` or after a day; `alertsCheckedAt`: epoch ms the last alert pass finished, absent before the first) | `live.json` |
| GET | `/v1/doctor` | yes | `?online=1` adds the network probes, never a model call (the providers row stays offline) and never the full-file SQLite integrity scan (the database row opens the file and reads its migrations; the full check is `doctor` in a terminal); `?check=<id>` runs one check, an unknown id is `invalid_body` | `DoctorReport` (`checks`: the CLI `doctor` rows in its words, each with `check` (the `doctor <check>` name, or `api` for the API token row), `status` `ok`, `info` (needs no action, never a problem), `warn`, `fail` or `cliOnly` (`config`, `daemon` and `trading` read the CLI process, so they come back with no `detail`: run `doctor` on the server for them), `ok` (`status` is `ok` or `info`) and `detail`; `checkedAt`: when the daemon ran them; `online`: whether `?online=1` was asked) | `doctor.json` |
| GET | `/v1/commands` | yes | — | `CommandList` (`estimate` on a command: the 25th to 75th percentile of what its last 10 runs that completed normally (stopped and failed runs are not counted) cost, over the runs that cost something, with `runs` the sample size; absent under 3 runs and for a command that hands the turn to an agent, which writes no row; `0` to `0` when none of the sample cost AI, and with `runs` 0 for a command that never calls a model (it only reads, and its policy does not vary by argument); a command whose policy varies by argument pools every argument under one name) | `commands.json` |
| GET | `/v1/commands/complete` | yes | `?line` (what is typed after the leading slash included, at most 500 characters; a line ending in a space completes a fresh position) | `CommandCompletion` (`candidates`: what the command's own completer offers at the position being typed, filtered by the partial token, sorted, empty for an unknown command, a name still being typed or a longer line; `usage`: the command's usage text in the daemon's language, absent when it has none) | `command-completion.json` |
| GET | `/v1/update` | yes | — | `UpdateResponse` (`enabled` false when checks are off or the daemon runs from a source checkout; the release feed is read once a day; `latest` is the newest release whether or not it is newer than `current`; `newer`: `latest` is newer than `current`; `notes`: `{version, important, summary?}` for each release newer than `current` up to `latest`, newest first, `summary` in the daemon's language, empty while the notes are unread; `upgradeCommand`: what to run on the daemon's machine) | `update.json` |
| POST | `/v1/restart` | yes | `RestartBody` (`when`: `idle` waits until nothing is working, at most `restartIdleWaitMs`, then restarts; `now` restarts at once) | 202 `RestartAcceptedWire` (`refusedApprovals`: approvals still waiting in `/v1/live`, which the shutdown refuses). The answer comes as soon as the restart is accepted; the daemon then stops through its normal shutdown (up to `restartDrainMs` for runs in flight), comes back with a new pid and files one `daemon_notice` (`noticeKind` `restart-done`) to the bell, nothing to a chat. Every request, accepted or refused, files one `/v1/activity` row: `kind` `command`, `name` `restart`, `channelId` `api`, `title` the `when` asked for, `startedAt` the request, `endedAt` when it ended, `outcome` `completed` (the helper took over and the daemon stopped), `aborted` (refused with the `conflict` below, or the daemon began stopping first) or `error` (the helper could not start or exited with this daemon still running). A restart that fails after the 202 is the same `error` row plus a `daemon_notice` of `noticeKind` `restart-failed`; a page waiting for down-then-up treats the same pid after `restartDrainMs` plus its own margin as failed, and the reason is in `daemon.stderr.log` and `doctor`; a boot that fails leaves no daemon to say so. `conflict` with a `message` in the daemon's language when it runs in a terminal or under a service, when a restart or an update is already under way, or while it is shutting down | `restart.json` |
| GET | `/v1/cost` | yes | `?from&to` (`YYYY-MM-DD`, both required, at most 366 days) | `CostReport` (`caps.warnRatio`: the share of a cap at which the daemon warns; each row's `billingAgentId` is the agent whose own daily cap the spend counted against, `agentId` the one that ran it; `jobs`: the same calls grouped by the top-level run each belongs to, child runs walked up the run edges, counted by billed time in the daemon's zone, one `{kind: command\|agent, name, runs, costUsd}` per job, costliest first; `otherUsd`: the calls whose top-level run has no run row (none written, still running, or pruned by retention), so `jobs` plus `otherUsd` add up to `totalUsd`) | `cost.json` |
| GET | `/v1/activity` | yes | `?day` (`YYYY-MM-DD`, the operator's day in `[locale] timezone`; today when absent; 400 when malformed) | `ActivityResponse` (`rows`: the top-level runs that ended in that day, newest first, at most 200: every finished long-running command except one that hands the turn to an agent, every restart request (`name` `restart`, see `/v1/restart`), every agent run whose answer reaches a surface, and nothing a debate role or a hidden run did on its own; each row's `children` are its direct children, oldest first, at most 20, a child being a run started by another run; `title` is the head of the request (at most 120 characters, credential-scrubbed), or the role and goal a delegated child was given; `summary` is the credential-scrubbed head of the answer a delegated child ended with, at most 500 characters, absent on every other run, and carried here only, never on `run_finished`; `costUsd` is the run and every run beneath it, not only the children listed; `unbilled` is `true` when neither the run nor any run beneath it made a model call, absent otherwise; `tickers` are the tickers the run's progress lines named, in the order first seen, at most 20, absent when it named none and on a run that ended before the daemon kept them; `questions` is `{ done, total }`, the research questions the run finished of how many it asked (a failed question and a review follow-up do not count), absent on any other run; `outcome` is a run result reason for an agent, `completed`, `aborted` or `error` for a command, the same words; history older than `[retention] days` is gone; it is written by every daemon and CLI process, whether or not the API is on) | `activity.json` |
| GET | `/v1/digest` | yes | `?day` (`YYYY-MM-DD`, the operator's day in `[locale] timezone`; today when absent; 400 when malformed) | `DigestWire` (`suggestions`: the calls an analyst made that day, by `created_at`, a recorded plan or a failed run not counted; `reports`: the brief stored for the day (counted by the day the brief itself carries, the market calendar's, so it can differ from the operator's day when `[locale] timezone` differs from the region's) plus the top-level deep-research runs that ended in the operator's day, a `/research` counted once; `spendUsd`: the day's model spend as `/v1/cost` counts it; `notable`: at most two, the first stop that broke that day, then the call that closed that day with the largest move either way, each `{kind: stop\|call, ticker, at, text}` with `text` in the daemon's words; no model writes any of it) | `digest.json` |
| GET | `/v1/research` | yes | `?before&limit` (`before`: epoch ms, the `endedAt` of the last report of the previous page, newest first when absent; `limit` at most 200) | `ResearchResponse` (`reports`: finished top-level `deep-researcher` runs, newest first; `sessionId` is the chat history the report is read from; `sources` is the admitted sources the run ended with, absent when it reported none; a page can hold fewer than `limit` reports, since a run with no session is left out, so keep paging until a page is empty) | `research.json` |
| GET | `/v1/notices` | yes | `?before&beforeId&limit` (newest first when `before` is absent; the next page is `before=<nextBefore>&beforeId=<nextBeforeId>`, a keyset on `(createdAt, id)` that skips no notice at a page edge, and `before` alone takes only notices strictly older (`beforeId` without `before` is `invalid_body`); `limit` at most 200) | `NoticesResponse` (`nextBefore` and `nextBeforeId`: the `createdAt` and `id` of the last notice the page read, both null when it is empty; `items`: the bell, newest first, each `{id,createdAt,readAt?,deliveredTo,event}` where `event` is the `WireEvent` exactly as a connected socket was sent it and `deliveredTo` the raw channel ids that also got it, empty for the bell alone and `api` for the app alone (a fill, `order_filled`, always reads empty: the chat notice of a resting exit is sent on its own and not recorded here); only weights `sneak`, `nudge` and `interrupt` are kept, never `quiet`; `unread`: notices without `readAt`; `needsYou`: the approvals waiting now plus the unread `stop_breached` notices; history older than `[retention] days` is gone; it is written by every daemon and CLI process, whether or not the API is on) | `notices.json` |
| POST | `/v1/notices/read` | yes | body `{ids?}` (absent, or no body: every unread notice; at most 500 ids; an already read notice keeps its first `readAt`) | `NoticesReadResponse` `{unread}`; every socket is then sent `notices_changed` | `notices.read.json` |
| GET | `/v1/board` | yes | — | `BoardResponse` (`entries`: the last 8 answers of long-running commands, newest first, each `{runId,name,channel,finishedAt,title,text,tickers}`; `text` is what the chat got, credential-scrubbed and cut at 4000 characters with a trailing `...`; `title` is the command's description in the daemon's language; a command that hands the turn to an agent adds nothing, and neither does a command that was already running when the API started, because its finish carries no name; it is held in memory, so a restart empties it and a daemon with the API off holds none) | `board.json` |
| GET | `/v1/tasks` | yes | — | `TasksResponse` (`tasks`: one row per background task the daemon runs, in the order it started them: every trading loop (`trading.exits` and `trading.intents` only when the daemon has an exchange to ask), `scheduler`, `retention`, `update`, `social`, `channels.watch`, `workflows` (only when a workflow has a schedule), and a plugin's own tasks; `label` is the task in the daemon's language, its own `name` for a plugin's task; `everyMs` the cadence where it has a fixed one, absent for `trading.refresh` and `trading.intraday`, whose wait is worked out from the market clock; `lastRunAt` epoch ms the last pass began, absent before the first, and advanced too by each offline check of a trading loop that found no network; `lastError` a sentence in the daemon's language for the last pass if it failed (no network, a missing key, or a generic one that points at the log; never the raw cause), cleared by the next good one; `nextRunAt` epoch ms the task's own timer fires next; `working` a pass is running now; `brief`: the `BriefScheduleWire` of `/v1/state`, with `nextDueAt`, absent when the brief was never enabled or trading is off; `intraday`: `{enabled,nextAt}`, `nextAt` epoch ms of the next report or `null` while it is off or no time is configured, absent when trading is off; held in memory, so a restart empties each task's last pass until its next one) | `tasks.json` |
| GET | `/v1/agents` | yes | — | `AgentsResponse` (the operator's own agents only: `paused`, `maxDailyUsd?`, `spentTodayUsd`, `focusKey`, `focusLabel`, `focus?` (its own `[focus]` as declared, lists deduped and sorted, `{markets?, sectors?, horizon?, goal?}`; absent when it declares none; `goal: income` marks an agent hunting dividends, and the goal is in neither `focusKey` nor `focusLabel`: agents differing only in goal share calls, and a focus holding only a goal is `default`), and once it has called: `record` of every focus it has used together (`resolvedCount`, `winCount`, `winRate?` only from 20 independent calls, `targetCount`: the independent calls that closed on their target), `agreement?` and `contrarian?` against the other agents, `overlapsWith`, and `social`: `[{network, state, reviewAll, drafts}]`, empty when the agent is on no social network; `look?`: its `[look]` parts) | `agents.json` |
| POST | `/v1/agents/:id/pause`, `/v1/agents/:id/resume` | yes | — | `{ "ok": true }` (an id that is not one of the operator's own agents is `not_found`; a paused agent refuses every run it owns until resumed) | — |
| GET | `/v1/agents/:id` | yes | — | `AgentDetailWire` (`systemPrompt`, `focus?: {markets?, sectors?, horizon?, goal?}` (`goal` in the profile's words, `preserve`, `income` or `grow`), `maxDailyUsd?`, `modelTier?`, `maxSpawn?`, `look?`; `editable` is true only for the operator's own agents, those in the data directory; a built-in or plugin agent reads with `editable` false; an unknown id is `not_found`) | `agent.detail.json` |
| POST | `/v1/agents` | yes | `AgentWriteBody` (`id`, `name`, `systemPrompt` required; `description?`, `focus?`, `maxDailyUsd?`, `modelTier?`, `maxSpawn?` (0 to 4; above 0 adds `spawn` to the tools), `look?` (`{part: value}`, at most 8 parts, each a lowercase slug of at most 24 characters; the daemon checks that shape and stores what it is given, the page owns which values mean something and derives a part left out from the agent id; the engine never reads it, and an edit replaces it like every other field); the tools are a fixed preset of web research, memory and read-only market and suggestion tools, never a shell or a file write) | `AgentDetailWire`; the agent answers on the next message, with no restart. A body that does not build the way the daemon builds an agent at boot (schema, id, focus, budget cap, prompt scan, tier) is `invalid_body` with a `message` in the daemon's language; an id already used by any agent or file is `conflict`, and so is a 51st agent of the operator's own (at most 50, with a `message`) | `agent.created.json` |
| PATCH | `/v1/agents/:id` | yes | `AgentWriteBody` (every field the page owns is replaced, or removed when left out; turn, token and time caps, `hosts`, `skills`, `delegates` and `reasoning` stay as the file has them; `id`, when sent, must match the path) | `AgentDetailWire`; a run already started keeps the definition it began with. `not_found` for an unknown id or one whose file has gone, `conflict` for a built-in or plugin agent, `invalid_body` as for POST | `agent.detail.json` |
| DELETE | `/v1/agents/:id` | yes | — | `AgentDeletedWire` `{ pausedSchedules }`: every schedule of the agent that was on is paused, its directory is removed, and the bell gets one `daemon_notice`; its log file is closed; its memory, sessions, spend and track record stay. `conflict` while it is on a social network or when it is built in | `agent.deleted.json` |
| POST | `/v1/agents/reload` | yes | — | `AgentsReloadWire`: the data directory read again; `loaded` the operator's own agents now in the registry, `skipped` each file left out with the reason as a sentence in the daemon's language (id taken, focus not fitting your book, or a generic one that points at the agent log; never the raw cause) (a file edited by hand is picked up this way; a skipped agent is dropped from the running registry until its file is fixed and reloaded; when the folder cannot be read at all the answer is `internal` with a `message`, and the running agents stay exactly as they were) | `agents.reload.json` |
| POST | `/v1/jobs` | yes | `JobCreateBody` (`agentId`, `prompt` and `schedule` required; `schedule` is `{kind:'cron',expr,timezone?}`, `{kind:'interval',everyMs}`, `{kind:'once',at}` (epoch ms, or a local `YYYY-MM-DD HH:mm` in the daemon's zone) or `{kind:'event',event,market?,ticker?,condition?,threshold?,typedPrice?,cooldownMs}`; `target?: {channel,chatId}`; the job has no owner, like one added from the CLI. An `event` job runs when an alert fires, not at a time: `stop` and `target` follow the exit levels of the names the operator holds, `mover` the screener's sharp moves, and `price` an alert armed for the job; no `ticker` means any name; `cooldownMs` is at least 300000 (the page offers 1800000, 7200000 and 86400000), and an any-name job runs at most once per cooldown. A `price` event needs `ticker`, `condition` and `threshold`: the alert is armed first, as `POST /v1/alerts` does (a level far from the market is `price_unconfirmed` until `typedPrice` is `confirmed`), the job owns that alert, so a level a live alert already covers is `invalid_body` with a `message`, and the job runs once and is spent) | The row `/v1/state` shows for it. `invalid_body` with a `message` in the daemon's language for a body the CLI would also refuse (an unknown agent, a prompt over 10 KiB or with an injection pattern, a bad cron, time or interval). While `[api] public_url` is set, a `target` on any channel but `api` is `conflict` with a sentence: a job for another chat is made on the server; a job sent with no `target` gets `{channel:'api',chatId:'app'}`, so it runs under the app's limits and answers in the app | `job.created.json` |
| DELETE | `/v1/jobs/:id` | yes | — | `{ "ok": true }`: a run in flight is cancelled, and a price job's alert is disabled with it. The whole id: a prefix or an unknown id is `not_found`, text that is no id at all is `invalid_body` | — |
| POST | `/v1/jobs/:id/pause`, `/v1/jobs/:id/resume` | yes | — | `{ "ok": true }`; `not_found` for an unknown id; resume of a `price` job whose alert has fired or been removed is `conflict` with a `message`, since nothing could start it | — |
| POST | `/v1/jobs/:id/run` | yes | — | 202 `{ "ok": true }` once the run is started, not when it ends: its answer reaches the bell as `schedule_result`. It runs under the daemon, so a client that hangs up cannot cancel it. `conflict` for a paused job; a job already running drops the second run | — |
| GET · POST | `/v1/pairing` | yes | `PairingDecisionBody` (POST) | `PairingList` (`pending`: codes waiting; `paired`: `{channel,chatId}` for every chat already paired, at most 200 per channel, in chat id order) / `PairingDecisionResult`. While `[api] public_url` is set, `approve` answers 409 `conflict` with a sentence naming `pair approve <code>` on the server; `deny` is unchanged | `pairing.json` |
| DELETE | `/v1/pairing/:channel/:chatId` | yes | — | `PairingRevokeResult` `{ revoked }`: the chat's pairing is taken back and its next message is asked for a code again; false when it was not paired and held no code. A malformed channel or chat id is `invalid_body` | `pairing.revoke.json` |
| POST | `/v1/runs/:runId/stop` | yes | — | 202 `RunStopWire` `{ stopped: true }`: the run was told to stop, whatever channel started it (stopping is safe, answering is not), and ends as `run_finished` with `outcome` `aborted` (an agent run or a command). A run that has finished or never existed is `not_found` with a `message` in the daemon's language; a malformed id is `invalid_body` | `run.stop.json` |
| GET | `/v1/runs/:runId/calls` | yes | — | `RunCallsWire` `{ runId, calls, truncated, totalCalls, totalUsd }`: the billed model calls of the run and everything beneath it (a child is a run started by another run, and so on down), newest first, at most 200, `truncated` when more exist; `totalCalls` and `totalUsd` count every call beneath the run whether or not the list was cut, and `totalUsd` is the run's `costUsd` on `/v1/activity`; each call is `{ at (settledAt, epoch ms), runId, parentRunId?, agentId, kind, provider, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, costUsd, latencyMs, outcome, errorCode? }`, a billed search (`kind` `external`) and every retried attempt included, `errorCode` the stored code of a failed attempt; metadata only, no prompt or answer; operator only, never given to a model; an unknown or unbilled run is an empty list; a malformed id is `invalid_body` | `run.calls.json` |
| POST | `/v1/respond` | yes | `RespondBody` | `{ "ok": true }` | `respond.approval.json` |
| GET · POST | `/v1/config`, `/v1/config/validate` | yes | raw config (POST) | config / validation / write result (see the notes below) | — |
| GET | `/v1/providers` | yes | — | provider catalog | — |
| POST | `/v1/providers/test` | yes | `{}` | `ProviderTestResult` (`{ok, model}` or `{ok:false, code}`) | — |
| GET · POST · DELETE | `/v1/auth/chatgpt` | yes | `{ method: 'browser' \| 'device' }` (POST) | `ChatgptAuthStatus`. While `[api] public_url` is set (booted, or saved in `config.toml` for the next start), POST answers 409 `conflict` with a sentence naming `auth login` on the server (the booted `public_url`, or `config.toml` when not booted yet); GET and DELETE unchanged | `chatgpt.json`, `chatgpt.login.json` |
| GET | `/v1/credentials` | yes | — | `CredentialsResponse` (`credentials`: every key variable the page may set, `{name, group, subject, set, fromShell}`, each name once, except a provider variable once per provider that reads it: `group` `provider` (the model chain's and tiers' variables, each with the provider that reads it, then the `envVar` of every catalog provider the config does not name), `venue`, `search` or `source`, in that order; `subject` the provider, venue, search provider or source that reads it; `set` the key file holds a value; `fromShell` the daemon's environment holds it and the key file did not put it there, so that value wins. Never a value, a prefix or a tail. The API token, channel tokens, MCP variables, the brand's control names and runtime names are never listed. `webSearch`: `{provider, providers}`, the provider the daemon searches with now and every one `[web_search] provider` may name). Answers while `public_url` is set too, so a page can show the server commands | `credentials.json` |
| POST · DELETE | `/v1/credentials/:name` | yes | `CredentialWriteBody` `{ value }` (POST: 1 to 4096 characters, one line, no control character, no space at either end) | `CredentialWriteResult` `{ name, restartRequired: true }` (written to the key file, mode 0600, read by the daemon after a restart) / `CredentialRemoveResult` `{ removed }` (false when the file held no value). A name not in `GET /v1/credentials` is `invalid_body` with `fields` on `name`, a refused value with `fields` on `value`; neither echoes the value. While `[api] public_url` is set (booted, or saved for the next start) both answer 409 `conflict` with a sentence naming `key set <NAME>` and `restart --background` on the server (it names the booted `public_url`, or says `public_url` is set in `config.toml` when not booted yet) | `credentials.write.json` |
| GET | `/v1/chat/sessions` | yes | `?channel&query&sessionId&before&beforeId&limit` (`channel` repeats (at most 20) and defaults to every channel; `query` keeps the sessions with a user or assistant message containing it, at least 2 and at most 100 characters, ignoring ASCII case, and the text as typed also matches, so a Vietnamese capital matches when typed as stored; `sessionId` keeps that one session, an empty list when it is unknown, and a malformed one is `invalid_body`; the next page is `before=<nextBefore>&beforeId=<nextBeforeId>`, a keyset on `(lastActivityAt, sessionId)` that skips no session at a page edge, and `before` alone takes only sessions strictly older (`beforeId` without `before` is `invalid_body`); `limit` defaults to 30, at most 100; anything else is `invalid_body`) | `ChatSessionsResponse` (`sessions`, newest activity first: `sessionId`, `channel` (`api` is this app), `chatId?`, `agentId`, `startedAt`, `lastActivityAt`, `messageCount`, `title?` its first message and `lastReply?` its last answer, each scrubbed of credentials and cut at 200 characters; `nextBefore` and `nextBeforeId` are null on the last page) | `chat.sessions.json` |
| DELETE | `/v1/chat/sessions/:id` | yes | — | `ChatSessionDeletedWire` `{ deleted }`: the app chat and its messages are removed (its spend stays); false when the id is unknown or already gone. A session of any channel but `api` is `conflict` with a `message` in the daemon's language naming its channel, and so is one whose turn is running; a command still waiting in the lane is not counted, and its answer is not kept once the session is gone. A malformed id is `invalid_body` | `chat.sessions.delete.json` |
| GET | `/v1/chat/recent`, `/v1/chat/history/:sessionId` | yes | `?limit&before` (history reads any session, a UUID from another channel included; only a session of the `api` channel takes a new message, so another channel's history is read-only; `limit` defaults to 30 and runs 1 to the session message cap, anything else is `invalid_body`; `before` is a transcript index (`idx`) and returns the rows older than it, a non-numeric or oversized value is ignored; `nextBefore` is the oldest returned row's `idx`; a page whose messages all render empty is possible, so keep paging while `hasMore`) | `ChatRecentResponse` (`sessionId`, and `agentId` when that session is bound to one of the operator's own agents, absent for the assistant) / message page | — |
| GET | `/v1/memory` | yes | `?limit` (1 to 500, default 500; anything else is `invalid_body`) | `MemoryResponse` `{ scopes, ttlDays, keyMaxLen, truncated }`: one group per memory scope the store holds (an agent and a user), the local user's first, then by agent and user, at most `limit` live rows in all (`truncated` when more exist; `limit=1` is enough for a client that wants only `ttlDays` and `keyMaxLen`). Each group: `scope` (its stable key, base64url of `agentId` NUL `userId`, never a list index), `agentId`, `agentName`, `userLabel` (a chat user as "{channel} {id}" when a channel's `allowed_ids`, `operator_user_ids` or pairing list holds the id, else the raw id), `isLocal` (the CLI and the web chat's own user, which a client names itself), `told` (`{key, attribute, value, updatedAt}`, one per preference told in a chat, `attribute` `style`, `constraints`, `interests`, `context` or `communication`) and `notes` (`{key, value, updatedAt, expiresAt}`, newest first, `expiresAt` null for a note that never expires). A preference change still waiting for the operator's answer is never sent; a group with nothing to show is left out. `ttlDays` is how long a note lives after its last update, `keyMaxLen` the longest key a write takes | `memory.json` |
| POST · DELETE | `/v1/memory` | yes | `MemoryWriteBody` `{ key, value, sessionId? }` (POST) / `?scope&key` (DELETE) | `MemoryWriteResult` `{ key, scope }` (`scope` the key of the scope written, as GET names it) / `MemoryForgetResult` `{ removed }`. POST writes the web chat's scope: the agent the `api` session `sessionId` is bound to (a binding to an agent no longer registered is passed over), else the `api` channel's entry agent, and the local user; without `sessionId`, the entry agent. A malformed `sessionId` is `invalid_body`, an unknown one `not_found`, another channel's session `conflict` with a sentence naming its channel. Not refused while `public_url` is set: a signed-in operator writing their own note is the same as chatting, which stays open there. A note is kept `ttlDays` and saving the same key replaces it; a refused key is `invalid_body` with `fields` on `key`, a refused value (empty, too long, a secret or an instruction) with `fields` on `value`, each with the sentence `/memory remember` answers with. DELETE forgets one key in one scope, for every surface that uses that scope; forgetting a told preference also drops a change to it waiting for an answer. A malformed `scope` (not base64url, not the key it re-encodes to, not exactly one NUL, an empty part, an id that is not a valid agent or user id) or `key` is `invalid_body`; a well-formed key with no live row answers `removed: 0` | `memory.write.json` |
| POST | `/v1/mcp` | yes | MCP JSON-RPC | MCP result (tools only) | — |
| GET | `/v1/quotes` | yes | `?market&ticker` (optional, both or neither: that one name, read live) | `TradingQuotesResponse` | `quotes.json` |
| GET | `/v1/ohlcv` | yes | `?market&ticker&fromDay&toDay` (all required) | `TradingOhlcvResponse` | `ohlcv.json` |
| GET | `/v1/events` | yes | `?market&ticker&fromDay&toDay` (all required) | `TradingEventsResponse` (ex-dates, meetings, splits, listings; `title` and `detail` are the source's own words; a market no event source covers, or a window with no event in it, answers an empty list with no caveat for the empty window; a source that could not answer is `upstream_failed` or `unavailable`) | `events.json` |
| GET | `/v1/news` | yes | `?region&limit` (optional) | `TradingNewsResponse` (a region's `items` take one headline from each of its markets in turn, each market's own ranking, so one market's feed cannot fill the limit; the list is then ranked as one) | `news.json` |
| GET | `/v1/profile` | yes | — | `TradingProfileResponse` | `profile.json` |
| POST | `/v1/profile` | yes | `{ patch }` | `TradingProfileResponse` | `profile.json` |
| GET | `/v1/portfolio` | yes | — | `TradingPortfolioResponse` (`unitCostNative`: the buy price in the market's own currency, fees included; `shares.segments`: `[{segment, weight, target, gap}]` as fractions of NAV, `gap` is `weight - target` and positive is over, rounded together with the same `apportion` and `FRACTION_QUANTUM` `/portfolio` prints with, so the page shows the chat's digits; a segment at zero held and zero wanted is left out; holdings carry no shares and print `weightPctNav` as `/portfolio` does) | `portfolio.json` |
| GET | `/v1/portfolio/nav` | yes | `?window=1m\|3m\|6m\|1y\|all` (default `3m`) | `TradingNavResponse` (`index` is time-weighted from 1; `periodReturn`, the drawdowns and leg `weight`s are fractions; `recordedCount` counts every snapshot kept, not the window's; `benchmark` is the operator's target mix with cash at 0, and when it is absent `benchmarkGap` says why: `unbenchmarked` when no target segment has a benchmark, `short-history` when a leg's closes do not span the window) | `portfolio-nav.json` |
| GET | `/v1/suggestions` | yes | `?status` (required: `open` each name's standing verdict, `ended` the scored closes newest close first, `all` every row newest first) `&market&ticker` (both or neither) `&focus` (a `focusKey`; `default`, the operator's own, when omitted; a key no agent has called under is `invalid_body`) `&cursor&limit` | `TradingSuggestionsResponse` (a hold carries `undecided: true` when it records a failed run, not a decision; `trailingStop` and `raisedStopFrom` say where the plan's stop rose to; `models`: the models that argued the call, sorted, absent on a call stored before they were kept; `reviewOnly: true` marks a plan whose lower level is a review, not a stop (a fund), absent otherwise) | `suggestions.json` |
| GET | `/v1/suggestions/:id/card` | yes | — | `SuggestionCardResponse` (`card`: the decision card in the daemon's words, `null` for an unknown id; a malformed id is a 400) | `suggestions.card.json` |
| GET | `/v1/suggestions/:id/debate` | yes | — | `DebateWire` (how the call was argued: `roles` each with its stored `summary` (absent for a risk analyst that wrote no note, and for a case the fact check refuted whole, as on the live `role_output`) and, except bull and bear, its `verdict` in the daemon's words; `claims` in the order to number them, with no side; `refutedIds` the claim ids the fact check refuted, empty on a call stored before they were kept; `models` the models that ran it; `steps` the roles the mode runs, the stored debate keeps no rounds; no cost; an unknown id, and a call with no stored debate such as a plan the exit tick recorded, are `not_found`; a malformed id is a 400) | `suggestions.debate.json` |
| GET | `/v1/track-record` | yes | `?limit` (optional) | `TradingTrackRecordResponse` (`text`: `/reflect`'s own lines; `acted`: the calls you took against the ones you passed; `summary.focuses[].targetCount`: the calls that closed on their target; `summary.byModel`: per model, the independent scored calls of your own record (the default focus, like the rest) whose debate ran on that one model alone, all time and not cut to `limit`, `winRate` only from 20 of them, a call several models argued or one stored before the models were kept in none) | `track-record.json` |
| GET | `/v1/brief` | yes | `?region` (optional) | `TradingBriefResponse` (`text`: the brief as the CLI prints it, without icons or indents; each section has a unique `id` and, for a market's, the market's name; `caveats`: the lines the CLI prints once at the end; the cost and the macro reference are not sections) | `brief.json`, `brief.empty.json` |
| PATCH | `/v1/brief` | yes | `{ sendTime: "HH:mm" }` (the market's timezone) | `BriefScheduleWire` (the delivery address is kept; 400 on a malformed time or a refused one, 409 when the brief is off and while it is being delivered, with the daemon's sentence as `message`) | `state.json` (`brief`) |
| GET | `/v1/screen` | yes | `?market` (required) `&kind&limit` | `ScreenResponse` | `screen.json` |
| GET | `/v1/instruments` | yes | `?q` (required, at most 40 chars) `&limit` | `InstrumentSearchResponse` | `instruments.json` |
| GET | `/v1/overview` | yes | — | `OverviewResponse` (the home region's markets first; per block `foreignNetValue` and, beside it, `foreignNetText`: the same figure signed and in the market's currency as the CLI prints it; `leaders?: {window, sessions?, foreignBuys?, foreignSells?, mostTraded?}`, each a list strongest first of `{instrument, value, sharePct?, changePct?}` (`value` in the market's currency, `sharePct` and `changePct` percents) and `movers?: {window, gainers, losers}` of `{instrument, changePct, turnover}`; `window` is `session` for a board that closes and `rolling-24h` for one that never does, `sessions` is absent on a rolling window, and a list the market does not measure is absent, never empty) | `overview.json` |
| GET | `/v1/markets` | yes | — | `MarketsResponse` (`homeRegion`; per market: price convention, region, `ownsRegion`, segment, `enabled` (the operator has that segment switched on; a registered market that is off is still listed, and world gold, kept for reference, is always off; when the daemon cannot read the profile it logs `api.markets_profile_unreadable` and answers with every market but world gold on), names in the daemon's language, benchmark, `session?: {exchange?, timeZone, open, close, breaks?: [{from, to}], closeAuction?: {from, to}, today, tradesToday, nextTradingDay, phase}`: the hours as `HH:MM` on that zone's clock from the market's calendar (`closeAuction` is the closing call auction, running to `close` inside the `open` phase; absent where the market closes without one; `exchange` is the exchange whose hours these are, a proper noun printed as is such as `HOSE`, absent where no one exchange sets them), then the market's day at the request: `today` and `nextTradingDay` as `YYYY-MM-DD` on its own clock, whether `today` trades (weekends and exchange holidays do not), and `phase` (`pre-open`, `open`, `break` for the lunch gap, `post-close`, `non-session` on a day it does not trade); a closure past the market's holiday table reads as a session, as it does everywhere in the daemon; absent for a market that trades around the clock, and whether it has a board, a brief and events) | `markets.json` |
| GET | `/v1/sectors` | yes | `?market` (required; an unregistered market is `invalid_body`) | `SectorsResponse` (`market`, `asOf`, `sectors` strongest first: `sector` slug, `label` in the daemon's language, `memberCount`, and the fractions `sessionReturn?` (today), `excessReturnShort?` and `excessReturnLong?` (20 and 60 sessions over the index), `score?`; a market that files no sectors answers an empty list and says why in `caveats`) | `sectors.json` |
| GET | `/v1/sources` | yes | — | `SourcesResponse` (`sources`: `id`, `kind`, `lastSuccessAt?`, `failure?` its last failure in the daemon's language, `breaker` `closed` or `open`; the daemon's memory of its own calls, so a daemon that has called nothing yet reports no success either) | `sources.json` |
| GET | `/v1/outbound` | yes | — | `OutboundResponse` (`hosts`: every host this config can call, `{host, purpose, sends}`; `purpose` is `model`, `exchange`, `channel`, `social`, `mcp`, `plugin`, `search`, `web`, `data`, `news`, `pricing`, `update` or `reachability`, `sends` says in the daemon's language what goes there; each is read from the code that owns it, never from a list kept beside it, and a host two purposes share is listed once under each; `web` has an empty `host`: it goes wherever you or an agent point it; a stdio MCP server names no host, an unofficial channel client (`zalo-personal`) names its own hosts so none is listed for it, the update row names the release page only and not the host a download redirects to, and under `mcp serve` no model host is listed; `model` also lists the token hosts of the providers in use: the ChatGPT login, Google and Azure cloud tokens) | `outbound.json` |
| GET | `/v1/models` | yes | — | `ModelsResponse` (`modelSource` `config` or `client`; `tiers`: each `{tier, models}` in the order its models are tried, a model being `{provider, model, supportsTools, price: {inPerM, outPerM, cacheReadPerM?, cacheWritePerM?, source}, perRunUsd?}`; prices are USD per million tokens as the cost ledger settles them, `perRunUsd` the mean cost of one run on that model over its last 10 runs inside the last 30 days, absent until it has run in that window; under `mcp serve` the connected client's model answers, so `tiers` is empty) | `models.json` |
| POST | `/v1/watchlist` | yes | `WatchlistUpdateBody` (`add?` and `remove?`, each at most 50 names as you would type them: `fpt`, or `crypto:hdb` where the market must be named; at least one name in all, anything else `invalid_body`) | `WatchlistUpdateResponse` (`added`, `removed` instruments, `unknown` names (nothing lists them) and `ambiguous` names (two markets claim them: write `market:ticker`); a refusal that names no name, because the market list is not loaded or a detector failed, answers every requested name as `unknown` with a `message` in the daemon's language saying so, never an empty answer; `remove` runs first, then `add`, each a save of its own, so the two are not atomic: an `add` that names something nothing matches, or two markets claim, saves none of its names, lists each such name in `unknown` or `ambiguous`, and leaves the `remove` applied; a name already listed or never listed changes nothing and is in neither list) | `watchlist.json` |
| GET | `/v1/macro` | yes | `?region` (optional) | `MacroResponse` (`readAt`: when the sources were read; `lean`: the CLI's one-sentence lean; `scoreRange`: the score's scale and the regime cuts; each driver, and each `missing` one, has its `label`) | `macro.json`, `macro.unavailable.json` |
| GET | `/v1/market` | yes | `?region` (optional, the home region when absent; a region no market owns is `invalid_body`) | `MarketSessionResponse` (`region`; `text`: what `/market` prints for that region, one entry per line in the daemon's language: the last closed session, what you hold and watch, and when the next report goes out; reads the sources, so it may take seconds and runs to the slow ceiling; no model) | `market.session.json` |
| GET | `/v1/themes` | yes | — | `ThemesResponse` (`themes`: every theme not rejected or retired, `{id, title, status, maturity}`, `status` `proposed`, `active`, `weakening` or `invalidated`; `text`: `/themes show`, one entry per line in the daemon's language; reads the store, no model) | `themes.json` |
| POST | `/v1/themes/:id/:transition` | yes | — (`transition` `approve` or `reject` for a proposed theme, `retire` for a tracked or invalidated one; anything else, or a malformed id, is `invalid_body`) | `ThemeTransitionResult` (`text`: `/themes`'s sentence for the move). A move the theme's status does not allow is 409 `conflict` with the sentence as `message`; an unknown id is `not_found` with its sentence | `themes.transition.json` |
| GET | `/v1/ledger` | yes | `?limit&cursor&fromDay&toDay` (optional) `&market&ticker` (both or neither: one name's rows) | `LedgerPageResponse` | `ledger.json` |
| POST | `/v1/ledger` | yes | `{ draft, typedPrice? }` + `Idempotency-Key` header (required) | `LedgerWriteResponse`. New refusal: a row in another currency where a rate applies (see `/v1/ledger/preview`) and that states none (`operatorFxRate`, `fxRateConfirmed`) is `invalid_body` with `fields` on `operatorFxRate`, so no client books it at a rate nobody saw; a client that records such rows (the desktop mirror) sends the rate. A withdrawal, fee or loss above the venue's cash is refused with `fields` on `amount` | `ledger.write.json` |
| POST | `/v1/ledger/preview` | yes | `{ draft, replacing? }` (`replacing`: the id of the row an edit replaces, left out of the book the draft is checked against) | `LedgerPreviewResponse` (writes nothing; `fxRate: {currency, rate, day}` is the day's market rate, book currency per unit of `currency`, present only where a rate changes what the row records: a deposit, a withdrawal, or a buy, sell or rights row at a venue holding none of that currency; ask for the rate there and send it as `operatorFxRate` with `fxRateConfirmed: true`; anywhere else send no rate, since one is refused; a draft the book would refuse is `invalid_body` as on POST) | `ledger.preview.json` |
| POST | `/v1/ledger/sync` | yes | `LedgerSyncBody` (`venue`; a venue no registry holds is `invalid_body`) | `LedgerSyncResponse` (`text`: `/record sync`'s reply in the daemon's language; `recorded`: rows written; `skipped`: fills left out, each named in `text`; reads the venue's filled orders and books those the ledger lacks under `<venue>:<orderId>`, the key `/trade` books under, so a fill lands once whichever path writes it; places no order; runs to the end even when the request goes away, bounded by the slow ceiling, so a client that times out reads the ledger again rather than sending it twice; a venue that cannot list fills answers its sentence with both counts 0) | `ledger.sync.json` |
| PATCH · DELETE | `/v1/ledger/:id` | yes | `{ draft, typedPrice? }` (PATCH, the whole row; an edit that leaves out a rate where one applies is refused with `fields` on `operatorFxRate`, as POST) | `LedgerWriteResponse` | — |
| GET | `/v1/stops` | yes | — | `StopsResponse` (`price`: the mark `distanceToStopPct` was measured from, absent when unpriced; `review`: a fund's lower level is a review, not a sale; `cover`: `placed` / `venue` / `none` stop order at the exchange, absent where none could rest) | `stops.json` |
| GET | `/v1/venues` | yes | — | `VenuesResponse` (every venue a trade can be recorded at and the markets it holds) | `venues.json` |
| GET | `/v1/rebalance` | yes | — | `RebalanceResponse` (`text`: the CLI's lines for this plan; the numbers beside them are for prefilling a ledger row) | `rebalance.json`, `rebalance.unavailable.json` |
| GET | `/v1/reconcile` | yes | — | `ReconcileResponse` (`text`: the CLI's `matched` and `cashNote` sentences, each `null` where it would not be true; `canSync`: the venue lists its fills, so `POST /v1/ledger/sync` can book them; each mismatch's `cash`: the asset is the venue's cash currency, which a deposit or withdrawal corrects rather than a trade) | `reconcile.json` |
| GET · POST | `/v1/alerts` | yes | `?limit&cursor` (GET); `AlertCreateBody` (POST) | `AlertsResponse` (`activeCount`: active alerts in all, not on the page) / `AlertWire` | `alerts.json` |
| DELETE | `/v1/alerts/:id` | yes | — | `AlertDisableResponse` | — |
| GET | `/v1/trade` | yes (`orders`) | — | `TradeStatusResponse` | `trade.json` |
| POST | `/v1/trade/staged/:token/confirm` | yes (`orders`) | — | `ConfirmOrderResponse` | `trade.confirm.json` |
| DELETE | `/v1/trade/staged/:token` | yes (`orders`) | — | `TradeActionResponse` | — |
| POST · DELETE | `/v1/trade/exits` | yes (`orders`) | `SetExitBody` (POST) + optional `Idempotency-Key` header; `?ticker&venue` (DELETE) | `ExitResponse` / `TradeActionResponse` | — |
| POST | `/v1/trade/halt` | yes (`orders`) | `HaltBody` | `TradeActionResponse` | — |
| POST | `/v1/trade/reconcile` | yes (`orders`) | — | `ReconcileOrdersResponse` (`orphanExits`: exits resting at a venue that no row tracks, listed and never cancelled; `unreadExitVenues`: venues whose exits could not be listed, so an empty `orphanExits` says nothing about them) | — |
| DELETE | `/v1/trade/unmirrored/:token` | yes (`orders`) | — | `TradeActionResponse` | — |
| POST | `/v1/session/code` | yes (token only) | — | `BrowserSignInCode` `{ code }`: a one-time code for `POST /v1/session`, good for `SIGN_IN_CODE_TTL_MS` (5 minutes); at most 16 wait at once, the oldest dropped first. A browser session is `unauthorized`: only the token mints codes | `session.code.json` |
| POST | `/v1/session` | no | `BrowserSignInBody` `{ code }` | `BrowserSignInResult` `{ ok: true }` with the session cookie in `Set-Cookie`. A wrong, used or expired code is `unauthorized` and counts toward the lockout; a valid one clears it. At most 20 sessions are kept; a new one drops the least recently used | — |
| POST | `/v1/session/logout` | yes | — | `BrowserSessionEndResult` `{ ended }` and a `Set-Cookie` that clears the cookie; the calling browser's session is removed and its sockets closed. `ended` is false for the token, which has no session | — |
| GET | `/v1/sessions` | yes | — | `BrowserSessionList` (`sessions`: the signed-in browsers, last used first; `label` is "<browser>, <os>" from the User-Agent, `''` when neither is known; `current` marks the browser that asked) | `sessions.json` |
| DELETE | `/v1/sessions/:id` | yes | — | `BrowserSessionEndResult` `{ ended }`: the session is removed and its sockets closed; false for an unknown id | — |
| GET | `/v1/ws` | yes (header or cookie) | WebSocket upgrade | 101 → §4 (feed) + §5 (chat) | `event.samples.json`, `chat.frames.json`, `chat.done.json`, `chat.error.json` |
| GET | `/v1/exec` | yes (header only, loopback only) | WebSocket upgrade | 101 → §6 (CLI forwarding) | `exec.frames.json` |

The trading shapes are in `wire/trading.ts`. The realtime feed and chat are **not** HTTP routes —
they are messages on the single `/v1/ws` socket (§4, §5). The `event.samples.json` / `chat.*.json`
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
  disabled; `channel`; `sendTime` HH:mm in the market's timezone; `nextDeliveryDay`; `nextDueAt` epoch ms the brief is next due, while scheduled). It is absent
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
- **`/v1/providers/test`** makes one tiny call through the saved primary model. `code` is the provider's
  error class (`auth` = key refused, `billing` = no credit, `rate`, `timeout`, `not_found`). A body
  naming `base_url` or `api_key_env` other than the primary model's is `invalid_body` with `fields`.
- **`GET /v1/config`** returns the raw `config.toml` as JSON with every literal secret (each value of
  an MCP server's `env`, and any string under a key matching `token`, `secret`, `password` or
  `api_key` that is not a `*_env` variable name) replaced by `redacted`, the placeholder the response
  carries. `POST /v1/config` and `/v1/config/validate` put the file's value back wherever the body
  still holds `redacted` (an array item is matched by its `name`, else its place); one the file has
  no value for is `invalid_body` with `fields`.
- **`POST /v1/config`** refuses, as `invalid_body` with one `fields` entry per path, any change
  against the file to what only the CLI or `config.toml` may change: `plugins`, `paths`, `storage`,
  `api`, `update`, `log.file`, `trading.orders.allow_unattended`, an MCP server's `transport`,
  `command`, `args` and `env` (servers matched by `name`, so a new stdio server counts as a change),
  every field naming an environment variable (`trading.sources` and each
  `trading.venues.<id>.credentials`, so the names `/v1/credentials` may write come only from the CLI
  or the file), and every `*_env`, `base_url` and `fallback_base_url` key anywhere. While `[api] public_url` is set
  it also refuses a change to any channel's `allowed_ids`, `operator_user_ids`, `pairing` or
  `dm_policy` (`channels.<id>.<key>`, with its own server-only sentence). An equal value passes;
  dropping a `*_env`, `base_url` or `fallback_base_url` key passes
  (the provider's own address and key variable take over), and so does an `api_key_env` set to the
  key variable the provider catalog names for the entry's `provider`. The list is
  `routes/config-guard.ts`. `/v1/config/validate` runs the same refusals and answers `ok: false`
  with one issue per refused path (a hidden secret, a CLI-only and a server-only change alike, each
  marked `refused: true`; its message already names the field), so a check and a
  save of one body agree.
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
  place orders (crypto exchanges) and `[api] orders` on (off by default while `public_url` is set);
  otherwise every order route, halt included, is 503. With `[api] orders` off, a `/trade` line on
  `/v1/ws` is a chat `error` naming the key, and app-channel runs are never offered `order_place`. An order is staged in chat (`/trade spot …`) or
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
  can tell a daemon too old for it before opening the socket. `brand` is the product's display name,
  so a page's sign-in screen names it before the token is entered, with no `package.json` bundled.
- **Browser sign-in**: a terminal holding the token mints a code with `POST /v1/session/code` and
  opens the page at `/#code=<code>`; the page trades it once with `POST /v1/session` for the
  session cookie. A code is single use and lapses after `SIGN_IN_CODE_TTL_MS`; codes live in
  memory, so a restart drops them, while sessions are stored and survive it.
- **`/v1/state` degraded**: what the daemon started without, one entry per item, worded in the
  daemon's language: `channel` (a chat channel left down, `subject` its id), `api`, `key` (an unset
  key variable or an exchange with no keys, with what waits for it) and `optional-key` (a feature with
  a keyless fallback, or an exchange with no keys: `subject` its venue id and `variables` the unset
  key names). Empty when everything is configured. It names variables, never their values,
  and sits behind auth rather than on `/v1/health` for that reason. The client shows each `message`
  as is.

## 4. `/v1/ws` — the proactive event feed

The daemon pushes one normalized event type, **`WireEvent`** (`events.ts`), as a `ServerFrame`
`{ type: 'wire_event', ...WireEvent }` (`socket.ts`) on the socket — for the connection's whole
lifetime, regardless of chat activity. The daemon assigns `weight` (routing tier) and stamps `source`
(`channel` + `agentId`) — the client never re-derives either. A `wire_event` carries **one payload
field matching its `kind`**, and the notices also carry `note`, the line a chat would get:

| `kind` | weight | payload field | when it fires |
|---|---|---|---|
| `run_started` | quiet | `run` `{kind,name,title?,channelId,sessionId,parentRunId?,hidden?,startedAt}` | an agent run or a long-running slash command began. `channelId` is the raw channel id (open, never folded into `Channel`), `name` the agent id or the command name, `sessionId` lets a client clear a pending question when the answer turn starts, `parentRunId` ties a delegated run to its parent and `hidden` marks one whose answer reaches no surface, so the feed shows that it ran and nothing more |
| `run_progress` | quiet | `progress` `{key,params?,text,mode,at}` | a run reported a step; `text` is already written in the daemon's language, `params` are credential-scrubbed, `mode` is `transient` (replaces the last line) or `persistent` (stays in the run's steps); transient progress is coalesced to at most 4 frames per second per run (the newest line wins, none is flushed later), `persistent` steps are always sent, and `GET /v1/live` always holds the latest line |
| `run_thinking` | quiet | `thinking` | a scrubbed tail of the model's reasoning, at most one per 2 s per run |
| `run_finished` | quiet | `outcome` + `tickers?` | a run ended: a run result reason (`completed`, `aborted`, `budget`, `error`, `turn_limit`, `loop`, `timeout`), or `completed` / `aborted` / `error` for a command; `tickers` are the names its progress lines mentioned, deduped, first seen first, at most 20, absent when none |
| `usage` | quiet | `usage` `{costUsd,tokens}` | declared for a per-run cost tick; the daemon does not send it today |
| `tool_started` | quiet | `tool` `{name,ok,capability}` + `runId` | an agent run's tool call passed admission and approval and is about to execute. `capability` is the tool's declared one (`read`, `net`, `memory`, `schedule`, `delegate`, `write` or `shell`), which is what a page places the call by; `ok` is `true` on a start, as nothing has failed yet. The start time is the frame's own. A tool with no declared capability (an unknown name, the engine's own search) sends nothing |
| `tool_result` | quiet | `tool` `{name,ok,capability,skipped?}` + `runId` | the call ended, whether the tool returned or threw: exactly one per call, after its `tool_started`. A call that never reached its tool (unknown, refused, blocked by a gate or an approval, or paired unrun because the run was steered or an approval timed out) sends this alone with `ok: false` and `skipped: true`. A chat turn's tools also arrive as `tool` chat frames |
| `role_output` | quiet | `role` `{ticker,market,role,stance?,summary?,citations,unsupported}` | one debate role's answer, sent for every role once the debate is verified. `role` is the debate role id; `stance` is its own conclusion in the daemon's language (a verdict, a stance or a trade stance); `citations` counts the sources it carried. `unsupported` is `true` when the evidence refuted every claim the role checked, and its `summary` is then absent. Never sent to a chat, never put in a prompt, and not kept in the bell: what a role said can carry a size or a level |
| `agent_added` | quiet | `agent` `{agentId,name}` | an agent was created with `POST /v1/agents` and is on the roster; read it with `GET /v1/agents/:id` |
| `approval_requested` | interrupt, `wake` | `approval` `{toolName,label,argsSummary,expiresAt,decisions,truncated?,channelId,answerable,askedAt}` + `requestId` | a tool gate needs a decision from any channel; offer only `decisions`, and only when `answerable`. `channelId` is the raw channel that asked, and any other channel answers it there. `label` is the tool's name in the operator's language; `expiresAt` (epoch ms) is when the gate denies on its own; `dangerous` is declared and not sent today |
| `approval_resolved` | quiet | `resolution` `{decision,by}` + `requestId` | it was answered, or timed out: clear its card |
| `clarification_requested` | interrupt | `clarification` `{text,sessionId,askedAt,channelId,answerable}` + `requestId` + `runId` | an agent asked a question and ended its run; the answer is the next chat message in `sessionId`, on the surface in `channelId` (the raw channel id) |
| `budget_warning` | nudge | `budget` `{period,spent,cap}` | a paid call is about to start and would take the period's spend, reserved calls and estimate included, past the warn share of a cap; once per period |
| `budget_exhausted` | interrupt, `wake` | `budget` `{period,spent,cap}` + `note` | settled spend reached the daily or monthly cap, so paid work is refused until it resets; once per period, and not when a single call's estimate alone would cross a cap |
| `provider_fallback` | quiet | `fallback` `{from,to,reason,attempt}` | a provider failed and the next one in the chain took the call; `reason` is the LLM error code |
| `pairing_requested` | interrupt | `pairing` `{channel,chatId,code,expiresAt}` | a chat was sent a pairing code; answer with `POST /v1/pairing` |
| `alert_fired` | nudge, `wake` | `alert` `{alertId,instrument,condition,threshold,observedPrice,level?}` + `note` | a price alert crossed; `level: target` on a plan's take-profit |
| `stop_breached` | interrupt, `wake` | `alert` (with `level: stop`) + `note` | a held name crossed its plan stop |
| `brief_ready` | nudge | `brief` `{snapshotId,day}` + `note` | the morning brief was stored; read `GET /v1/brief` |
| `mover` | nudge | `mover` `{instrument,condition,observedPrice,movePct?,benchmark?}` + `note` | a watched or held name moved past its usual range |
| `order_filled` | nudge, `wake` | `fill` `{instrument,venue,side,quantity,price,closeReason?}` + `note` | a fill the ledger now holds, from `/trade` or a resting exit (`closeReason` `stop` or `target` on a sale a resting leg made); the one event for a fill, so a chat's exit notice is not repeated as another kind |
| `call_scored` | nudge; quiet for an own agent's call | `call` `{suggestionId,ticker,market,action,status,returnPct,benchmark?,focusKey,day}` + `note` | a call just scored, once. The operator's own record's call comes from the app (`source.agentId` empty). A focus call, a second opinion scored apart, comes once per own agent that has called under that focus, named in `source.agentId`, weight `quiet`: it is for the page's live feed only, never filed to the bell or sent to a chat whatever `[notices] chat` says. `status` is `target`, `stop` or `expired`, and `returnPct` is a fraction net of fees (0.05 is 5%), like a suggestion's `outcome.returnPct`. `benchmark` `{ticker,returnPct}` (a fraction) is the market's own benchmark over the same span and is absent where the market names none. `day` is the call's day. Only a call whose window ended within two days of the pass is told, so the first pass after an upgrade does not flood the bell. Not sent to a chat unless `[notices] chat` lists `call-scored`; read it with `GET /v1/suggestions/:id/card` |
| `alerts_checked` | quiet | `checkedAt` | one alert pass finished (about every minute); a pass reads one cursor page of alerts, not the whole book; `GET /v1/live` keeps the last as `alertsCheckedAt` |
| `idea` | nudge; quiet for an own agent's call | `idea` `{suggestionId,instrument,action,conviction}` | a buy or reduce was stored (checked each minute). A call of the operator's own record comes from the app (`source.agentId` empty); a call under an own agent's `[focus]` comes once per own agent using that focus now, named in `source.agentId`, weight `quiet`. Read it with `GET /v1/suggestions?status=open`, adding `&focus=<focusKey>` for an agent's |
| `schedule_result` | sneak | `note` | a scheduled job's or heartbeat's result, or the text a chat would get with no event of its own |
| `notice` | nudge | `note` + `noticeKind?` + `instrument?` + `movePct?` | any other daemon notice, as text. `noticeKind` is the notice's own name, so a page can place it (for example `held-news`, `index-drop`, `delivery-disabled`). `held-news` is news on a name you hold, once per held name per day: `instrument` `{market,ticker}` is that name. `index-drop` is the region's index falling at least 1.5% in a session, once per session: `movePct` is its move, a percent (-1.7 is down 1.7%). Neither goes to a chat unless `[notices] chat` lists the kind. Held-name news covers only names the daemon has already read: headlines are archived when a `/suggest` or a chat reads that name, and nothing fetches news for your holdings on a schedule |
| `daemon_notice` | nudge | `note`, `noticeKind?` | a sentence the daemon filed to the bell for itself (a restart finished, an agent deleted); it never goes to a chat. `noticeKind` is `restart-done` or `restart-failed` for the restart a page asked for, absent on the rest |
| `notices_changed` | quiet | `unread` | the bell changed: a notice was written, or some were read, and `unread` is the count after. Refetch `GET /v1/notices` on it rather than on the event that caused it, so the row is there when you read |
| `preference_saved` | quiet | `preference` `{attribute,value,change,sessionId}` | a chat stored a preference the operator told (`change` `added` or `updated`) or dropped one (`removed`, `value` empty), in the scope of the agent in `source.agentId`; `sessionId` is the chat it was told in, so a page can say so under that answer and reread `GET /v1/memory`. Never sent to a chat and not kept in the bell |

- **What a delivered line becomes.** Everything the daemon sends to a channel also reaches the open sockets as one event, chosen by what the line is. A line with no typed notice behind it (a scheduled job's result, a heartbeat, any plain text a chat is sent) is `schedule_result`, weight `sneak`, with the text in `note`; so a page sees every scheduled result and every plain send, and none is lost for want of a kind of its own. A typed notice is its own kind (`alert_fired`, `stop_breached`, `mover`, `brief_ready`, `call_scored`), and one with no kind of its own becomes `notice` with `noticeKind` naming it. A filled resting exit sends nothing here: `order_filled` is its one event.

- **The app is a delivery address.** While the api runs, the daemon delivers alerts, stop hits,
  the brief and movers addressed to channel `api` straight to the open sockets, and to `api` too
  when no chat channel is attached. What a chat channel accepted is also sent to the open sockets
  once, as the same event, so the page sees what the chat saw. A socket whose send was dropped (closed, or its buffer full) does
  not count as reached: with no socket taking the frame the delivery fails and the daemon retries
  later, as it would for an offline chat.

- **The bell is a log.** The kinds listed here are written to the daemon's database as they happen,
  whether or not a socket is open or the API runs, so a page that opens late reads them from
  `GET /v1/notices` and marks them read with `POST /v1/notices/read`. Read state is the daemon's, one
  operator. Written: delivered notices, approvals, clarifications, pairing codes, spent budgets, fills and
  `daemon_notice`, and only of weight `sneak`, `nudge` or `interrupt`. Not written: `approval_resolved` and
  the other `quiet` kinds, and `budget_warning` and `idea`, which a page hears on its socket alone.
  An own agent's `call_scored` is `quiet`, so it is not written either.
  `call_scored`, `held-news` and `index-drop` notices are bell-only: they are written to the bell and
  sent to the open sockets, and to no chat, unless `[notices] chat` names their kind
  (`call-scored`, `held-news` or `index-drop`; any other name is refused at boot).

- **`wake`** is `true` on `approval_requested`, `stop_breached`, `alert_fired`, `order_filled` and `budget_exhausted`
  and absent on every other kind: the events worth bringing a sleeping client back for.
- **`weight`** ∈ `interrupt | nudge | sneak | quiet` — a hint; each client maps it to its own surface
  (a system notification, a toast, a badge). The hint is shared, the rendering is not.
- **`source.channel`** ∈ `Channel` = `cli | telegram | cron | api`. (The scheduler surface is **`cron`**,
  not `"scheduler"`.)
- **Live view.** A client that shows what the daemon is doing opens the socket, waits for `welcome`,
  then fetches `GET /v1/live` and applies the events that arrive meanwhile. It merges by `runId`:
  `run_started` adds a run, `run_progress` and `run_thinking` update it (a `transient` line replaces
  the last, a `persistent` one is also kept in the run's steps), `run_finished` removes it, and
  a `run_progress` for a run it does not hold is a run already in flight, so it adds one. A
  snapshot taken before an event can lack the run that event names; the merge by `runId` makes the
  order harmless. `pending` is the same: an approval leaves on `approval_resolved`, its
  `expiresAt` or when its run is gone (a snapshot no longer lists it), a question on the next
  `run_started` whose `run.kind` is `agent` in its `sessionId` (a command's start answers nothing). A run asked for on this
  socket's own chat reaches it twice, as `chat` frames (the answer) and as run events (the
  feed); the feed is the view of the work, the frames are the reply. Reconnecting starts again
  from a fresh snapshot, since events sent while the socket was down are not replayed.
- **Liveness:** the WS layer (Bun) sends automatic protocol pings and reaps an idle peer; there is **no
  application-level heartbeat frame** to ignore. Sockets close on daemon
  shutdown; clients reconnect with backoff.

## 5. `/v1/ws` — chat (bidirectional)

Chat runs on the **same socket** as the feed. The client sends `ClientFrame`s (`socket.ts`):

- `{ type: 'chat', message, sessionId?, id? }` — start a turn. A `message` whose first non-space char is `/`
  runs the shared **slash dispatcher** (channel surface) instead of an agent run. `id` is the
  client's own id for the message (at most 64 letters, digits, `-` or `_`; anything else closes the
  socket as an invalid frame). Every frame the message produces then carries it as `id`: a short
  command's reply and `done`, a lane command (whose lane id it becomes, so `drop` takes it), a
  long command held behind the session's turn (which also answers `{ kind: 'queued', id,
  sessionId }` and, as it begins, `{ kind: 'started', id, sessionId }`), and the agent turn a message or a command hands off to, which answers
  `{ kind: 'started', id, sessionId }` as it begins (and `queued` with `sessionId` while it waits),
  so a client knows a new session before `done`. A `tool` frame keeps its tool call's `id` and
  carries no tag. A tagged command outside the lane may also end with `{ kind: 'dropped', id }`
  (cancelled) or an `error` carrying `id`. A message sent without `id` gets today's frames
  unchanged.
- `{ type: 'steer', message, sessionId?, id? }` — add a message to the turn already running; it reads it
  at its next turn boundary and the daemon answers `{ kind: 'steered' }`. A steer sent with an
  `id` has it echoed on `steered` and on the `steer_dropped` that follows if the turn ends before
  reading it. A turn that already
  ended, or ends before reading it, answers `{ kind: 'steer_dropped', text }` with the CLI's
  sentence asking to send it again; the message is never run on its own. A `/` command is not
  steered: it runs as `chat`.
- `{ type: 'cancel', sessionId }` — interrupt the current turn, stop the session's running self-contained
  commands and drop the ones waiting in the command lane (each answers `dropped`).
- `{ type: 'drop', sessionId, id }` — take one waiting command out of the line (`id` from its
  `queued` frame). The lane rejects it and the socket that ran it answers `dropped`; a command that
  already started is untouched and an unknown `id` is ignored.
- `{ type: 'hello', contractVersion }` — the handshake; the daemon answers `{ type: 'welcome',
  contractVersion }`, or closes with 1011 and the reason `contract <N> required` (`N` the version it
  needs; `CONTRACT_REFUSED_CLOSE_CODE` and `CONTRACT_REFUSED_REASON_PREFIX` in `wire/socket.ts`) when the
  version differs, so a client can tell it is outdated. A frame that is not one of
  these shapes closes the socket with 1002 `invalid_frame`.
- **binary frame** (not JSON) — ignored: dictation is transcribed on the device and sent as text.

The daemon replies with `ServerFrame`s tagged `type: 'chat'`:

- `{ type: 'chat', ...ChatFrame }` (`chat.ts`): `text` / `reasoning` deltas, `tool` (run→ok/error),
  `usage` footer, `subagent` activity. Scrubbing + tool-display + usage formatting are **daemon-side**;
  the client only renders.
- `{ type: 'chat', kind: 'progress', text, id? }` — a long slash command's current step in the operator's
  words; each replaces the last, and the turn ends with `done`.
- `{ type: 'chat', kind: 'done', reason, id?, runId?, sessionId?, haltCode?, haltDetail? }` — turn finished (`reason: 'slash'` when dispatcher-handled). `runId` is the run the answer came from: the command's run, or the agent turn's engine run (the `runId` of its `run_started` / `run_finished` events). `sessionId` is the session it belongs to, so a client that sent none learns the one the turn opened. A halted run adds `haltCode` (`budget`, ...) and, when the halt has one, `haltDetail`: a budget ceiling (`run_budget`, `daily_cap`, `monthly_cap`, `agent_daily_cap`, `ledger_unavailable`) or a provider error code on an `llm_error` halt, so an app can say which ceiling or failure stopped it.
- `{ type: 'chat', kind: 'error', code, message, id? }` — turn failed. `code` is an `ApiErrorCode` (section 7);
  `message` is a sentence in the daemon's language, never the error's own text.

**Command lane.** The self-contained commands (`/suggest`, `/screen`, `/rebalance`, `/brief`, `/refresh`,
`/price`, `/overview`, `/market`, `/portfolio`, `/reconcile`, `/themes`, `/schedule run`, plugin
workflows) run beside the session's turn instead of behind it: up to 3 at once per chat, up to 10
waiting in order. Every frame such a command sends (`text`, `progress`, `done`, `error`) carries `id`,
the lane entry's id, so the client ties it to the line that started it; a frame without `id` belongs
to the session's own turn.

- `{ type: 'chat', kind: 'queued', id, position }` — the command waits; `position` is its 1-based
  place in line. A plain `{ kind: 'queued' }` is still a turn held behind another.
- `{ type: 'chat', kind: 'started', id, runId? }` — it left the line and began. `runId` is the run the
  feed shows it as (`run_started`, `command_progress`, `run_finished`).
- `{ type: 'chat', kind: 'dropped', id }` — the command ended without a result: removed while it
  waited (`drop`, `cancel`, `/new`, shutdown), or cancelled after it started (`cancel`, `/new`). A full line answers the existing `error` frame (`unavailable`, `errors.queueFull`).

A `chat` sent while a turn runs waits behind it (`queued`); a `cancel` or a disconnect aborts the
running turn. Shutdown starts by closing admission: no new connection, no new HTTP request, and a
`chat` or `steer` frame on an open socket is answered with `{ type: 'chat', kind: 'error', code:
'unavailable' }`; requests already running finish. A run already going still settles in the drain
window, and the sockets close after it.

## 6. `/v1/exec` — CLI forwarding

One connection runs one CLI command inside the daemon, for a terminal on the same machine: the
daemon runs the command against the connection as its terminal, and the terminal only relays bytes,
size, raw mode, signals, edits and the exit code. Closing the connection cancels the command.
Frames are JSON text (`ExecClientFrame` / `ExecServerFrame`, `wire/exec.ts`); every string is
UTF-8 text.

**Admission**, checked in this order before the upgrade; the first that fails answers over HTTP:

1. The daemon is shutting down → `503 unavailable`.
2. Any proxy header (`X-Forwarded-For`, `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-Proto`,
   `X-Real-IP`, `Via`, `CF-Connecting-IP`, `True-Client-IP`) → `403 forbidden`, with or without
   `public_url`.
3. An `Origin` header (a browser always sends one) → `403 forbidden`.
4. A peer that is not loopback → `403 forbidden`.
5. `Host` other than exactly `127.0.0.1:<[api] port>` → `403 forbidden`. A reverse proxy or
   `tailscale serve` on the same machine presents a loopback peer, so this and the proxy check are
   what keep a remote caller out.
6. `Authorization: Bearer <token>` only; the session cookie is never read. A missing token is
   `401 unauthorized`; a wrong one is `401` and counts toward the shared lockout (§1), a locked
   peer is `403 forbidden`.
7. The exec sockets have their own cap (separate from `/v1/ws`); over it → `503 too_many_streams`.

A refusal after the upgrade closes with **4400** (`EXEC_REFUSED_CLOSE_CODE`) and one of these
reasons; nothing has run, so the terminal MAY run the command itself:

- `too_many_streams`: two handshakes raced to the last seat.
- `invalid_frame`: the first frame is not a valid `exec`, or no frame came within 10 s of the
  upgrade (an authenticated peer that never speaks cannot hold a seat).
- `contract <N> required`: `exec.contractVersion` is not the daemon's (`N`, prefix
  `CONTRACT_REFUSED_REASON_PREFIX` in `wire/socket.ts`).
- `unavailable`: the daemon started shutting down after the upgrade.

Terminal → daemon:

- `{ type: 'exec', argv, terminal, env, quiet, verbose, noColor, contractVersion }` — the first
  frame. `argv` is the command line after the global flags. `terminal` says whether stdin, stdout
  and stderr are TTYs and gives `columns` and `rows` (read only for a TTY stream; send `0` for a
  stream with no size). `env` carries the terminal's `NO_COLOR`, `FORCE_COLOR`, `TERM`, `CI`,
  `LANG`, `LC_ALL`, `LC_CTYPE`, `VISUAL` and `EDITOR`, for rendering and editing only; the daemon
  drops any other name. The command runs with the daemon's own config, key file and environment.
- `{ type: 'input', data }` — stdin text; `{ type: 'input_end' }` when piped stdin reaches its end.
- `{ type: 'resize', columns, rows }` — the terminal's new size.
- `{ type: 'signal', signal: 'interrupt' | 'terminate' }` — Ctrl+C, or the terminal is going away.
  The command handles it as it does in-process; when nothing in it listens, the daemon ends it
  with `exit` 130 (interrupt) or 143 (terminate).
- `{ type: 'edited', kind: 'exited', code, text? }` — the editor exited with `code`; `text` is the
  file as it left it. The daemon keeps the text only when `code` is 0 and it changed.
  `{ type: 'edited', kind: 'failed', message }` — the editor could not start; `message` is shown as
  the editor's failure.

Daemon → terminal:

- `{ type: 'accepted' }` — the command started. **From here on the client never falls back:** any
  close that is not after `exit` means the daemon went away while the command ran, and it is not
  run again.
- `{ type: 'output', stream: 'out' | 'err', data }` — output, in order, at most 65,536 characters
  a frame.
- `{ type: 'raw', on }` — switch stdin's raw mode; sent only on a change.
- `{ type: 'edit', editor, fileName, text }` — open `editor` on a file named `fileName` holding
  `text`, then answer `edited`. One edit is open at a time.
- `{ type: 'exit', code }` — the command's exit code; the daemon then closes with 1000.

Daemon shutdown closes every exec socket with 1001 `shutdown` and aborts its command. A command that
fails outside anything it could report itself closes with 1011 `internal`. A frame
after `accepted` that does not parse, or is larger than the frame cap, is ignored (the daemon logs
the first). Binary frames carry nothing. The WS layer's pings, sent to a socket idle for 120 seconds, keep an idle command (a REPL at its
prompt) open. The daemon logs each command's path (`schedule add`), exit code and duration, never
its arguments, input, edits or output.

## 7. Errors

Every non-2xx response body is **`ApiError`** = `{ "error": { "code": ApiErrorCode, "message"? } }` — a
stable code, never a leaked internal message. `message` is set only when the runtime refused with a
sentence written for the operator (a ledger row the book cannot hold, say), in the daemon's
language; show it as is. Codes and statuses are `wire/errors.ts` (`API_ERROR_STATUS`):
`unauthorized`(401) `forbidden`(403) `not_found`(404) `invalid_body`(400) `conflict`(409) `price_unconfirmed`(422) `upstream_failed`(502) `too_many_streams`/`unavailable`(503) `timeout`(504)
`internal`(500). `invalid_body` is every malformed request: JSON that does not parse, a body over its size cap, a path id that is malformed, a refused field. For a ledger draft, a job, an agent, a config write, a key test or a memory note it also carries `fields`: `[{path, message}]`, one per refused field, `path` the field in the body you sent (`quantity`, `instrument.ticker`; empty for the body as a whole, which the sentence calls "this entry" or "the request") and `message` its sentence in the daemon's language, with the first repeated as `message`; mark each field and show the sentences as they are. `price_unconfirmed` also carries `unconfirmedPrice` (`UnconfirmedPriceWire`): the
typed price, the market's latest price and the day it stands for. Fixtures: `error.unauthorized.json`,
`error.price-unconfirmed.json`, `error.fields.json`.

## 8. Independent-development workflow

1. **Daemon team** implements against `wire/` (import the types; never redefine) and
   verifies handlers with `curl` + by emitting the fixtures.
2. **Client team** mirrors the shapes in its own types and checks that every fixture decodes
   through them.
3. **Either side** changing a shape edits `wire/*.ts` + this doc + the fixture together; the other side
   sees a failing decode (or a typecheck error, for TS) and updates its mirror. The fixture diff is the
   hand-off.
