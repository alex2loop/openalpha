import type { Channel, WireEvent } from '@/app/server/wire/events'
import type { ProgressWire, RunStartWire } from '@/app/server/wire/live'
import type { BusEventMap } from '@/core/events'
import type { Locale } from '@/core/types/locale'
import { APP_SOURCE, isApiChannel } from '@/app/server/channel'
import { WIRE_DECISION } from '@/app/server/decision'
import { scrubCredentials } from '@/core/security/credentials'
import { decisionsFor } from '@/engine/api'
import { translateToolLabel } from '@/i18n'

/** The bus topics the socket relays as wire_event frames. */
type WireTopic =
  | 'approval_requested'
  | 'approval_resolved'
  | 'clarification_requested'
  | 'budget_warning'
  | 'provider_fallback'
  | 'pairing_requested'
  | 'run_started'
  | 'run_finished'
  | 'run_thinking'
  | 'command_started'
  | 'command_finished'

/** The progress topics: their wire line is rendered (and may be dropped) before the event is built,
 *  so the normaliser takes it ready. */
type ProgressTopic = 'run_progress' | 'command_progress'

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
      label: e.label,
      argsSummary: e.argsSummary,
      expiresAt: e.expiresAt,
      decisions: decisionsFor(e.scope, e.oneTime).map((decision) => WIRE_DECISION[decision]),
      ...(e.truncated === undefined ? {} : { truncated: e.truncated }),
      channelId: e.channel,
      answerable: isApiChannel(e.channel),
      askedAt: e.askedAt,
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
    runId: e.runId,
    requestId: e.requestId,
    clarification: {
      text: scrubCredentials(e.question),
      sessionId: e.sessionId,
      askedAt: e.askedAt,
      channelId: e.channel,
      answerable: isApiChannel(e.channel),
    },
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
  run_started: (e) => ({
    v: 1,
    kind: 'run_started',
    weight: 'quiet',
    source: { channel: wireChannel(e.channel), agentId: e.agentId },
    runId: e.runId,
    run: toAgentRunWire(e),
  }),
  run_finished: (e) => ({
    v: 1,
    kind: 'run_finished',
    weight: 'quiet',
    source: { channel: wireChannel(e.channel), agentId: e.agentId },
    runId: e.runId,
    outcome: e.reason,
  }),
  run_thinking: (e) => ({
    v: 1,
    kind: 'run_thinking',
    weight: 'quiet',
    source: { channel: wireChannel(e.channel), agentId: '' },
    runId: e.runId,
    thinking: e.excerpt,
  }),
  command_started: (e) => ({
    v: 1,
    kind: 'run_started',
    weight: 'quiet',
    source: { channel: wireChannel(e.channel), agentId: '' },
    runId: e.runId,
    run: toCommandRunWire(e),
  }),
  // `result` stays on the bus: a command's reply is read in-process and never put on the wire.
  command_finished: (e) => ({
    v: 1,
    kind: 'run_finished',
    weight: 'quiet',
    source: { channel: wireChannel(e.channel), agentId: '' },
    runId: e.runId,
    outcome: e.outcome,
  }),
}

/** The approval event with its tool label in the operator's language, as every surface prints it. */
export function toApprovalWire(e: BusEventMap['approval_requested'], locale: Locale): WireEvent {
  return WIRE_NORMALIZERS.approval_requested({
    ...e,
    label: translateToolLabel(locale, e.toolName, e.label),
  })
}

export const PROGRESS_NORMALIZERS: {
  readonly [K in ProgressTopic]: (e: BusEventMap[K], progress: ProgressWire) => WireEvent
} = {
  run_progress: (e, progress) => ({
    v: 1,
    kind: 'run_progress',
    weight: 'quiet',
    source: { channel: wireChannel(e.channel), agentId: e.agentId },
    runId: e.runId,
    progress,
  }),
  command_progress: (e, progress) => ({
    v: 1,
    kind: 'run_progress',
    weight: 'quiet',
    source: { channel: wireChannel(e.channel), agentId: '' },
    runId: e.runId,
    progress,
  }),
}

export function toAgentRunWire(e: BusEventMap['run_started']): RunStartWire {
  return {
    kind: 'agent',
    name: e.agentId,
    ...(e.title === undefined ? {} : { title: e.title }),
    channel: e.channel,
    sessionId: e.sessionId,
    ...(e.parentRunId === undefined ? {} : { parentRunId: e.parentRunId }),
    ...(e.hidden === undefined ? {} : { hidden: e.hidden }),
    startedAt: e.startedAt,
  }
}

export function toCommandRunWire(e: BusEventMap['command_started']): RunStartWire {
  return {
    kind: 'command',
    name: e.name,
    channel: e.channel,
    sessionId: e.sessionId,
    startedAt: e.startedAt,
  }
}
