import type { Channel, WireEvent } from '@/app/server/wire/events'
import type { BusEventMap } from '@/core/events'
import { APP_SOURCE } from '@/app/server/channel'
import { WIRE_DECISION } from '@/app/server/decision'
import { decisionsFor } from '@/engine/api'

/** The bus topics the socket relays as wire_event frames. */
type WireTopic =
  | 'approval_requested'
  | 'approval_resolved'
  | 'clarification_requested'
  | 'budget_warning'
  | 'provider_fallback'
  | 'pairing_requested'

// The bus carries the full ChannelId union; the v1 wire narrows to these. An unmapped channel
// (e.g. a future adapter) renders as 'api' rather than widening the frozen wire contract.
const WIRE_CHANNELS: ReadonlySet<string> = new Set<Channel>(['cli', 'telegram', 'cron', 'api'])

function wireChannel(channel: string | undefined): Channel {
  // why-safe: the `WIRE_CHANNELS.has` check above proves `channel` is a member of the `Channel`
  // union; the cast only re-narrows the widened bus type back to what the runtime check already proved.
  return channel !== undefined && WIRE_CHANNELS.has(channel) ? (channel as Channel) : 'api'
}

// The bus payloads carry the originating channel (`approval_requested` carries `channel`);
// `source.channel` preserves it so the socket can filter and the client knows the source.
// The trading notices (`alert_fired`, `stop_breached`, `brief_ready`, `mover`) and scheduled
// results arrive through the app's notice surface (`push/notices.ts`), and `idea` from the
// suggestion watch (`push/ideas.ts`), not from bus topics.
export const WIRE_NORMALIZERS: { readonly [K in WireTopic]: (e: BusEventMap[K]) => WireEvent } = {
  approval_requested: (e) => ({
    v: 1,
    kind: 'approval_requested',
    weight: 'interrupt',
    source: { channel: wireChannel(e.channel), agentId: e.agentId },
    runId: e.runId,
    requestId: e.requestId,
    approval: {
      toolName: e.toolName,
      argsSummary: e.argsSummary,
      decisions: decisionsFor(e.scope, e.oneTime).map((decision) => WIRE_DECISION[decision]),
      ...(e.truncated === undefined ? {} : { truncated: e.truncated }),
    },
  }),
  approval_resolved: (e) => ({
    v: 1,
    kind: 'approval_resolved',
    weight: 'quiet',
    source: { channel: wireChannel(e.channel), agentId: '' },
    requestId: e.requestId,
    resolution: { decision: e.decision, by: wireChannel(e.channel) },
  }),
  clarification_requested: (e) => ({
    v: 1,
    kind: 'clarification_requested',
    weight: 'interrupt',
    source: { channel: wireChannel(e.channel), agentId: '' },
    clarification: { text: e.question, sessionId: e.sessionId },
  }),
  budget_warning: (e) => ({
    v: 1,
    kind: 'budget_warning',
    weight: 'nudge',
    source: { ...APP_SOURCE, agentId: e.agentId },
    budget: { period: e.period, spent: e.spent, cap: e.cap },
  }),
  // Quiet: the answer still arrives, just from another model. Worth showing, not worth interrupting.
  provider_fallback: (e) => ({
    v: 1,
    kind: 'provider_fallback',
    weight: 'quiet',
    source: { channel: wireChannel(e.channel), agentId: '' },
    fallback: { from: e.from, to: e.to, reason: e.reason, attempt: e.attempt },
  }),
  // Interrupt: the code lapses, and the person in the chat is waiting on an answer.
  pairing_requested: (e) => ({
    v: 1,
    kind: 'pairing_requested',
    weight: 'interrupt',
    source: { channel: wireChannel(e.channel), agentId: '' },
    pairing: { channel: e.channel, chatId: e.chatId, code: e.code, expiresAt: e.expiresAt },
  }),
}
