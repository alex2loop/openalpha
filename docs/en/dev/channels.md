# Channels

For developers adding or changing a channel. Setting one up as an operator? See [Channels](../channels.md).

The engine never learns which channel a message arrived on. A channel answers four questions and gets
out of the way:

- Is this person allowed in?
- Is the message written somewhere durable before we tell the upstream API we have it?
- Is it a slash command, or something for an agent?
- How do I render the answer so it survives this transport?

Everything else (agent loop, command catalog, cost ledger, persistence) sits behind
[src/channels/api.ts](../../../src/channels/api.ts) and is not a channel's business. That line keeps a
new transport cheap and keeps a transport bug away from the ledger.

## Identity and registration

`ChannelId` is a branded, validated string, not a closed union. Build one with `channelId(value)`, so a
new channel never means editing a central list.

[src/channels/registry.ts](../../../src/channels/registry.ts) is the registry, bound as the `channels`
service by `channelsProvider`. It starts with the built-ins (`telegram`, `zalo`, `zalo_personal`), then
merges:

1. executable `ChannelDefinition` contributions from trusted bundled plugins;
2. declarative channel sources from installed plugins, limited to the base definition's
   `safeConfigOverrides`.

A contributed definition needs the registered id and the full definition shape. Invalid definitions and
unsafe declarative overrides are skipped with a scrubbed reason in the log (`channel.definition_skipped`,
`channel.declarative_skipped`). Duplicate executable ids are rejected when plugins merge. Embedders can
also pass definitions through the `channels` option of `boot` ([Extending](./extending.md)).

## Channel definition

```ts
interface ChannelDefinition<T extends ChannelDeliveryConfig = ChannelDeliveryConfig> {
  readonly id: ChannelId
  readonly safeConfigOverrides?: readonly string[]
  resolveConfig(raw: unknown): T
  isEnabled(config: T): boolean
  admission(config: T): ChannelAdmission
  create(config: T, context: ChannelContext): ChannelAdapter
}
```

A definition handles two things: this transport's config and creating the adapter. Generic delivery
settings are normalized once by `resolveChannelSettings`. Declarative plugins may change only the fields
in `safeConfigOverrides`; absent means none. Telegram and Zalo allow `SAFE_DELIVERY_OVERRIDE_FIELDS`
(`markdown`, `mid_stream_updates`, `typing_indicator`, `use_reactions`, `notify_max_per_minute`);
Zalo Personal allows none.

`createChannel(def)` is the author-time factory. It brands the id, rejects unknown keys and checks the
adapter functions exist.

`create` receives a `ChannelContext`: `logger`, `pollOffsets`, `inbox` (the durable inbox), `env` (injected;
resolve `token_env` against it, never `process.env`) and `dataDir` (write on-disk state here, never under
`$HOME`).

## The adapter contract

```ts
interface ChannelAdapter {
  readonly id: ChannelId
  readonly capabilities: ChannelCapabilities
  readonly renderer: ChannelRenderer
  start(handlers: AdapterHandlers, signal: AbortSignal): Promise<void>
  send(out: ChannelOutbound, options?: { readonly signal?: AbortSignal }): Promise<SentRef>
  dispose(): Promise<void>
  edit?(req: EditRequest): Promise<void>
  chatAction?(chatId: string, action: 'typing'): Promise<void>
  setReaction?(req: ReactionRequest): Promise<void>
}
```

- `start` resolves once the channel is **up**: credentials verified, handlers armed. It does not stay
  pending for the channel's life. The receive loop runs detached and stops on `signal`, so boot fails
  fast on a bad token while a mid-life fault only marks the status unhealthy.
- `dispose` is idempotent and tears down every listener, timer and in-flight call the adapter owns.
- `AdapterHandlers` gives you `onMessage`, `onCallback`, `setStatus`, and optionally `canAdmit` (false
  for a chat or user no admission rule could ever let in; absent means store everything) and
  `commandsForMenu`.
- `renderer` owns markup: `chunk` encodes and splits raw text (escaping before it encodes twice and
  shows up as visible backslashes), `escape` is only for fragments that bypass `chunk`, and
  `normalizeTables` rewrites tables.

A channel declares what it can do, and delivery branches on that, never on the channel's name:

```ts
interface ChannelCapabilities {
  readonly inlineButtons: boolean
  readonly markdown: 'none' | 'markdownv2'
  readonly typing: boolean
  readonly reactions: boolean
  readonly canEdit: boolean
  readonly maxTextLen: number
}
```

Declare these honestly. Claiming `canEdit` when you cannot is how a live progress line turns into forty
duplicate messages.

### Typed choices

A channel without `inlineButtons` cannot show a keyboard, so `delivery/choices.ts` mints one four-digit
code per button (`/4821`), keyed by chat, and the approval prompt and the plan review append them as
lines. `handleTypedChoice` runs first in `route`, before the mention rule, and turns a live code into
the same `ChannelCallbackQuery` a tap makes. Admission (`gate.admitCallback`) runs before the code is
consumed, so a member who is not the operator leaves it live for the one who is; `discard` then drops
the code and its siblings. Each entry carries the prompt's own `expiresAt` and the LRU only bounds
memory, so the expiry is cleanup: the resolvers still decide, and an unknown request answers
"already answered or expired".

### Button payloads

`callback_data` is `action:rest`. Besides `abort` and the approval and plan decisions, `cmd:` carries a
slash command that a message offered as a button. Telegram caps `callback_data` at 64 bytes
(`TELEGRAM_CALLBACK_DATA_MAX_BYTES`); a longer payload degrades to a text line.

Treat a `cmd:` payload as hostile input: a client can send any `callback_data` it likes. It does not
reach a handler directly. It re-enters the same path a typed message takes, with the same admission,
role gate, rate window and session, using `query.from` as the user and carrying `query.isGroup`. A
payload that names no slash command goes to the control callbacks instead.

## What a message carries

Inbound (`InboundMessage`): `channel`, `chatId`, `userId`, `messageId`, `text`, an epoch-ms `receivedAt`,
and optional `reactionRef`, `isGroup` and `addressedToBot`. Outbound (`ChannelOutbound`): `channel`,
`chatId`, `text`, and optional `replyToMessageId`, `buttons`, `useMarkup` and `silent`.

Ids are opaque strings above the adapter. Numeric Telegram ids are normalized to strings before any
admission check, so `12345` and `"12345"` cannot disagree about who you are.

A forwarded message carries text the operator did not write. Before storage that text is wrapped in
`<pasted_content id="...">` tags with a random id, and the chat agent's prompt treats the contents as
data unless the operator's own words ask it to act. The wrapped text does not start with `/`, so a
forwarded command does not run.

## Admission

```ts
interface ChannelAdmission {
  readonly mode: 'allowlist' | 'pairing'
  readonly allowedIds: readonly string[]
  readonly operatorUserIds: readonly string[]
}
```

| Mode | Behavior |
|---|---|
| `allowlist` | Only configured chat or user ids are admitted |
| `pairing` | Configured ids are admitted; unknown chats get a one-time pairing code |

There is no open mode: every admitted chat acts as the single local operator, so an unrestricted channel
would expose that operator's ledger, profile and memory to any sender. Config can also disable a channel
before an admission mode is created.

Telegram pairs when `pairing = true` and defaults to pairing only when no allowlist exists. Zalo reads
`dm_policy = pairing | allowlist | disabled`, defaulting to pairing. Zalo Personal is allowlist only.

Pairing fails closed:

- a configured operator can list, approve, deny or revoke pairings;
- a paired chat cannot pair other chats;
- repeated unknown messages do not mint unlimited codes;
- a storage failure rejects admission;
- pending codes expire under the pairing store's policy.

## From arrival to answer

Polling adapters write the normalized message or callback to the inbox (`InboundInbox`, through
`acceptInbound`) **before** advancing the upstream offset. A crash between the two replays the message; a
crash in the other order would lose it. An update from a chat or user that no admission rule could let in
(`canAdmit` is false) is not stored, so a stranger cannot grow the inbox. Under `pairing` everything is
stored.

The drain then works through the inbox:

- `claimPending` takes a lease on entries; `renewClaims` keeps a live run's lease while an approval
  pauses its deadline.
- `recoverStalled` requeues entries whose lease expired (the run duration cap plus 5 minutes), so a dead
  daemon's work is picked up again.
- A failed attempt retries until `inboxMaxAttempts` (3), then the entry is dead-lettered and logged as
  `channel.inbox_dead_lettered`. A requeued entry carries `retry_at` (10 s, doubling per attempt, capped
  at 5 minutes) and both claim statements skip an entry not yet due, so a network blip does not burn every
  attempt in under a second.

Delivery is at-least-once, but a finished run is never executed twice. When the final write of an answer
fails, the inbox keeps that answer on the entry (`answer`), and the retry sends only the final message,
not the live progress, instead of running the agent and its tools again. A message folded into one reply
with others sends it once; its siblings complete without a reply. Two cases still re-run: the daemon dies
while the final write is in flight, and the answer is too large to keep (over 256 KiB,
`MAX_STORED_ANSWER_CHARS`).

Once admitted:

1. control and pairing commands are handled;
2. slash commands go through the canonical dispatcher;
3. ordinary text is debounced and routed to the selected agent and session;
4. the per-session queue and the daily and monthly budget gates run before anything new executes;
5. stream events update the live response, and the final result is delivered.

Session keys include channel and chat identity, so two transports never share transcript state.

## Sending the answer back

Delivery owns:

- transport-safe escaping and chunking;
- typing and reaction feedback where supported;
- live progress edits when `mid_stream_updates` and `canEdit` are both true;
- slash-command menus where the adapter supports them;
- localized completion and error copy, and the cost footer;
- outbound notification rate and queue bounds (`ChannelSettings`: debounce, edit throttle and queue sizes
  are fixed, `notifyMaxPerMinute` defaults to 3).

A channel never reads raw tool arguments. The engine decides what is safe to show and emits it as
`tool_execution_start` and `tool_progress` events, so no adapter has to be trusted with a shell
command's text.

### What the bot remembers it sent

Each channel runtime keeps a bounded in-memory map from `(chat, message id)` to the kind of thing the
bot sent there: an answer chunk (and whether the run footer is on it) or a notice (and its label). It
holds ids, kinds and labels, never message text, it holds up to 2,000 entries, and it is gone after a
restart. A message that is not in the map, whether pushed out, sent before a restart, slash output, or a
footer that went out as a chunk of its own, is simply unknown, and the reader of the map degrades to a
pointer rather than the text.

### Reply context

On a Telegram or Zalo Personal direct chat, a message that replies to one of the bot's own messages carries `replyTo` (the
replied message's id and text, and the `quote` the operator selected). Group chats never set it: the
sent-message map is per chat, not per user, so one member's reply could otherwise pull another member's
answer into their session. Zalo Personal fills it from `data.quote` when `quote.ownerId` is the bot's own
id, with `globalMsgId` as the replied message's id (what `send` returns and the map records). The Zalo
Bot API sends no quote.

`runExchange` turns it into a lead with `toReplyLead`:

- for an answer, the replied text (or the selected quote, if it lies inside the answer body) wrapped as
  pasted content and cut to a fixed length;
- for a notice, only its label;
- for anything else, a one-line pointer.

The run footer (LLM cost, tokens, model calls) is hidden from models like an operator figure: it is cut off
the replied text, and a quote that touches it falls back to the whole footer-less body. A footer that went
out as a message of its own is never filed, so a reply to it gets the pointer. A replayed inbox entry
keeps `replyTo` and meets an empty map after a restart, so it too gets the pointer.

A reply is never steered into a run that is still going: it waits for that run and gets its own, so it
carries its lead. A burst of messages batched into one run keeps only the reply of its last message.

### Quiet-gap note

The gap is measured from the newest `session_messages` row (`SessionActivity.lastMessageAt`), never
`sessions.last_activity_at`, which slash commands also touch. When that row is older than
`gap_note_minutes`, the lead opens with one line saying how long the chat was quiet and that earlier prices
may be out of date. A failed read logs `channel.gap_note_lookup_failed` and skips the note, so it never fails
the turn. The key is in `deliveryFields` but not in `SAFE_DELIVERY_OVERRIDE_FIELDS`, so a declarative plugin
channel cannot override it.

### The lead is never stored

`runExchange` passes the gap note and the reply lead as `RunInput.lead`, once per run. The engine appends it
as a transient user message just ahead of the operator's text, as it does for the restored todo list: the
model reads it for that run, and `history show` and `/v1` chat history show only what the operator typed.
The session, its route and its history do not change, and `/new` stays the explicit fresh start.

## Where a terminal-armed notice goes

`TradingNoticeSender.resolveRecipient(origin)` answers an alert or brief arming. A routable origin comes
back as is. The terminal (`LOCAL_CHANNEL_ID`) resolves to the daemon's live default recipient when
channels are attached, and otherwise to `resolveConfiguredRecipient` (`channels/recipient.ts`): the first
enabled definition in registry order with a fallback chat, from config alone. `resolveFallbackChat` is the
one rule for a channel's fallback chat (`fallback_chat_id`, else a lone allowed id) and `start.ts` uses it
too. `AlertService.create` and the brief's `scheduleOf` resolve once, so no surface does.

## Startup and shutdown

`startChannels` resolves and validates every registered definition, creates each enabled adapter and
starts them with `Promise.allSettled`, so one stale token cannot stop the others. A start failure is
never fatal: a channel whose `start()` throws is disposed and dropped, so it never listens and admits
nobody. An `OperatorConfigError` (token missing or rejected) logs `channel.start_skipped` and comes
back in `StartChannelsResult.skipped` for the daemon to report; anything else logs
`channel.start_failed`. A problem found while building a runtime (an unknown agent, a bad value) still
throws before any channel starts. If none start, CLI-only operation is valid.

Only a token the provider refuses counts as configuration: HTTP 401 or 403 from Telegram, and 401 from
Zalo, whose own error table lists 403 as a server fault. Any other `getMe` failure is transport, and both
adapters try it up to four times with a capped backoff before dropping the channel. Zalo Personal has no
token to refuse; it retries its login in the background (5 seconds initial, 5 minutes maximum).

`startChannels` returns `{ stop, snapshots, skipped, notifier?, defaultRecipient? }`: shutdown, health
snapshots, the channels left down, an outbound sender that routes to the runtime owning a channel (`AcknowledgedRouter`), and a default
proactive recipient. That recipient is the channel's `fallback_chat_id`, or its only allowed id when it
has exactly one. `stop` settles every runtime disposal and never lets one failed cleanup block the rest.

## Adding a channel

1. Implement a `ChannelDefinition` and a `ChannelAdapter` behind `channels/api.ts`, in
   `channels/adapters/<name>/`.
2. Keep transport parsing, rendering and credentials inside that folder.
3. Declare truthful capabilities and enforce `maxTextLen` in the renderer.
4. Accept the shutdown signal before arming listeners or polling.
5. Register the definition at composition, normally through a trusted bundled plugin.
6. Add config and doctor validation through the definition's schema path.

If you are about to add a per-channel `if` to delivery, command, approval or persistence code, the
capability you need is missing from `ChannelCapabilities`. Add it there.

## Source map

- [src/channels/api.ts](../../../src/channels/api.ts): the module's public surface
- [src/channels/types.ts](../../../src/channels/types.ts): `ChannelDefinition`, `ChannelAdapter`, `ChannelCapabilities`, `InboundInbox`
- [src/channels/define.ts](../../../src/channels/define.ts): `createChannel`
- [src/channels/registry.ts](../../../src/channels/registry.ts): registration and plugin merge
- [src/channels/schema.ts](../../../src/channels/schema.ts): `resolveChannelSettings`, delivery config keys
- [src/channels/start.ts](../../../src/channels/start.ts): `startChannels`
- [src/channels/delivery/](../../../src/channels/delivery/): admission gate, inbox drain, queue, streaming, replies
- [src/channels/adapters/](../../../src/channels/adapters/): `telegram`, `zalo`, `zalo-personal`
- [Extending](./extending.md), [Internals](./internals.md)
