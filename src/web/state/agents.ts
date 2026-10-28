import { type ReadonlySignal, signal } from '@preact/signals'

import type { AgentDetailWire, AgentWire, AgentWriteBody } from '@/app/server/wire/agents'
import type { ModelsResponse } from '@/app/server/wire/models'
import { pluralKey } from '@/i18n'
import { getJson, sendJson } from '@/web/api/client'
import { startPoll } from '@/web/api/poll'
import { ROUTES } from '@/web/api/routes'
import { createSingleFlight } from '@/web/api/single-flight'
import { dropDoneCallbacks, sendMessage } from '@/web/state/chat'
import { onWireEvent } from '@/web/state/events'
import { tr } from '@/web/text/tr'

const AGENTS_POLL_MS = 30_000
/** The focus that is the operator's own: an agent on it has no call apart from the plan. */
export const SHARED_FOCUS = 'default'
// The `/agent` argument that hands the chat back to the assistant.
const ASSISTANT_TARGET = 'default'
/** How often an agent agrees with the others says something only from this many shared names; the
 *  daemon sends the count, not a threshold. */
export const MIN_SHARED_NAMES = 3

/** What the agent form edits: the agent as the daemon reads it back, less what the page cannot set. */
export type AgentDraft = Omit<AgentDetailWire, 'editable'>

type ModelTierWire = ModelsResponse['tiers'][number]

/** An ask to open the agent form, prefilled with `draft`; `seq` tells two asks apart. */
interface AgentFormRequest {
  readonly draft?: Partial<AgentDraft>
  readonly seq: number
}

const list = signal<readonly AgentWire[]>([])
const isRead = signal(false)
const isFailed = signal(false)
const formRequest = signal<AgentFormRequest | undefined>(undefined)
const selected = signal<string | undefined>(undefined)
// The running roster read, so a save is seen at once; absent while signed out.
let refetchRoster: (() => Promise<void>) | undefined

/** The operator's own agents; empty until read, and kept when a later read fails. */
export const agents: ReadonlySignal<readonly AgentWire[]> = list
/** The roster has been read once: an empty `agents` then means there are none. */
export const agentsRead: ReadonlySignal<boolean> = isRead
/** The latest roster read failed; the poll asks again. */
export const agentsFailed: ReadonlySignal<boolean> = isFailed
/** The latest ask to open the agent form; the form opens on each new one. */
export const agentFormRequest: ReadonlySignal<AgentFormRequest | undefined> = formRequest
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

  refetchRoster = refetch

  return () => {
    lifetime.abort()
    stopPoll()
    off()

    if (refetchRoster === refetch) {
      refetchRoster = undefined
    }
  }
}

/** Opens the agent form to create an agent, its fields prefilled from `draft`. */
export function requestAgentForm(draft?: Partial<AgentDraft>): void {
  const seq = (formRequest.value?.seq ?? 0) + 1

  formRequest.value = draft === undefined ? { seq } : { draft, seq }
}

/** Throws `ApiFailure`; an abort is the caller's own. */
export function loadDetail(agentId: string, abortSignal?: AbortSignal): Promise<AgentDetailWire> {
  return getJson(
    ROUTES.agentDetail(agentId),
    abortSignal === undefined ? {} : { signal: abortSignal }
  )
}

/** Creates the agent, or replaces every field of `existingId`; the daemon answers it on the next
 *  message, with no restart. Throws `ApiFailure` with the daemon's sentence. */
export async function saveAgent(draft: AgentDraft, existingId?: string): Promise<void> {
  const body: AgentWriteBody = draft

  if (existingId === undefined) {
    await sendJson('POST', ROUTES.agentCreate, { body })
  } else {
    await sendJson('PATCH', ROUTES.agentDetail(existingId), { body })
  }

  await refetchRoster?.()
}

/** Deletes the agent; its schedules that were on are paused, its record stays. Typing that went to
 *  it goes back to the assistant. Throws `ApiFailure`. */
export async function removeAgent(agentId: string): Promise<{ readonly pausedSchedules: number }> {
  const answer = await sendJson('DELETE', ROUTES.agentDelete(agentId))

  if (selected.value === agentId) {
    selectAgent(undefined)
  }

  await refetchRoster?.()

  return answer
}

/** A paused agent refuses every run it owns until it is resumed. Throws `ApiFailure`. */
export async function setPaused(agentId: string, paused: boolean): Promise<void> {
  await sendJson('POST', paused ? ROUTES.agentPause(agentId) : ROUTES.agentResume(agentId))
  await refetchRoster?.()
}

/** The tiers an agent may run on: only those whose every model can call tools. Throws `ApiFailure`. */
export async function loadToolTiers(abortSignal: AbortSignal): Promise<readonly ModelTierWire[]> {
  const answer = await getJson(ROUTES.models, { signal: abortSignal })

  return answer.tiers.filter(
    (tier) => tier.models.length > 0 && tier.models.every((model) => model.supportsTools)
  )
}

/** "5/9 chạm mục tiêu" once `minSample` calls are scored, else "Thử việc 2/5 đã chấm". */
export function reputationLine(agent: AgentWire, minSample: number): string {
  const { record } = agent
  const count = record?.resolvedCount ?? 0

  if (record !== undefined && count >= minSample) {
    return tr(pluralKey(count, 'ui.office.agent.repShortOne', 'ui.office.agent.repShort'), {
      hit: record.targetCount,
      count,
    })
  }

  return tr(pluralKey(count, 'ui.office.agent.trialShortOne', 'ui.office.agent.trialShort'), {
    count,
    min: minSample,
  })
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
    isRead.value = true
    isFailed.value = false
  } catch {
    // The who-chip keeps the roster it last read; a stopped read is no failure.
    isFailed.value = !abortSignal.aborted
  }
}
