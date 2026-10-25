import { type ReadonlySignal, signal } from '@preact/signals'

import type { AgentWire } from '@/app/server/wire/agents'
import { getJson } from '@/web/api/client'
import { startPoll } from '@/web/api/poll'
import { ROUTES } from '@/web/api/routes'
import { createSingleFlight } from '@/web/api/single-flight'
import { dropDoneCallbacks, sendMessage } from '@/web/state/chat'
import { onWireEvent } from '@/web/state/events'

const AGENTS_POLL_MS = 30_000
/** The focus that is the operator's own: an agent on it has no call apart from the plan. */
export const SHARED_FOCUS = 'default'
// The `/agent` argument that hands the chat back to the assistant.
const ASSISTANT_TARGET = 'default'

const list = signal<readonly AgentWire[]>([])
const selected = signal<string | undefined>(undefined)

/** The operator's own agents; empty until read, and kept when a later read fails. */
export const agents: ReadonlySignal<readonly AgentWire[]> = list
/** The agent typing goes to on this page, as the daemon last accepted; absent is the assistant or
 *  not known yet (a resumed session's binding is not read). */
export const selectedAgentId: ReadonlySignal<string | undefined> = selected

/** Reads the roster now, every `AGENTS_POLL_MS` and on every `agent_added`. */
export function startAgents(): () => void {
  const lifetime = new AbortController()
  const refetch = createSingleFlight(loadAgents, lifetime.signal)
  // `refetch` never rejects: `loadAgents` keeps its own failure.
  const off = onWireEvent('agent_added', () => refetch().catch(() => undefined))
  const stopPoll = startPoll(() => refetch(), AGENTS_POLL_MS)

  return () => {
    lifetime.abort()
    stopPoll()
    off()
  }
}

/** Sends `/agent <id>` (no AI cost); the chip changes once the daemon answers without an error.
 *  False when the socket is not live. */
export function selectAgent(agentId: string | undefined): boolean {
  if (agentId === selected.value) {
    return true
  }

  return sendMessage(`/agent ${agentId ?? ASSISTANT_TARGET}`, {
    isSystem: true,
    onDone: () => {
      selected.value = agentId
    },
  })
}

/** A new session talks to the assistant until the operator picks again; a switch still waiting
 *  for its answer no longer applies. */
export function clearAgentChoice(): void {
  dropDoneCallbacks()
  selected.value = undefined
}

/** A resumed session shows the agent the daemon says it talks to; absent is the assistant. */
export function resumeAgentChoice(agentId: string | undefined): void {
  selected.value = agentId
}

async function loadAgents(abortSignal: AbortSignal): Promise<void> {
  try {
    list.value = (await getJson(ROUTES.agents, { signal: abortSignal })).agents
  } catch {
    // The who-chip keeps the roster it last read.
  }
}
