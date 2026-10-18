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
