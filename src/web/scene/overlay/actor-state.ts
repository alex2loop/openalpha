import { computed } from '@preact/signals'

import type { PendingWire } from '@/app/server/wire/live'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId, ActorStatus, SimView } from '@/web/scene/types'
import type { Run } from '@/web/state/live'
import { lifeTextOf } from '@/web/scene/overlay/bubbles'
import { teamGoals } from '@/web/scene/overlay/team-pass'
import { ASSISTANT, ownActorIdOf, ownAgentIdOf } from '@/web/scene/sim/actors/roster'
import { goalsFor, holderOf } from '@/web/scene/sim/vocabulary'
import { agents, selectedAgentId } from '@/web/state/agents'
import { thread } from '@/web/state/chat'
import { APPROVAL_KIND, findRun, pending, runs } from '@/web/state/live'
import { TRUNCATION_MARK } from '@/web/text/glyphs'
import { formatRunName } from '@/web/text/run-name'

// A queued question shows this much of itself.
const QUEUED_TEXT_MAX = 40

/** What a person really does now, from the live store, the chat, the office life and its dot. */
export type ActorNow =
  | { readonly kind: 'paused' }
  /** An approval or a question waits on the operator; `isAtDesk` once they carry it to your desk. */
  | { readonly kind: 'asking'; readonly what: string; readonly isAtDesk: boolean }
  | { readonly kind: 'queued'; readonly what: string }
  | { readonly kind: 'busy'; readonly run: Run }
  | { readonly kind: 'life'; readonly line: string }
  | { readonly kind: 'dot'; readonly status: ActorStatus }

/** What the live store calls for, as the director reads it: who works on which run, who waits. */
export const wantedGoals = computed(() => goalsFor(runs.value, pending.value))
/** The office crew's goals and the team floor's, for whatever stands over a person. */
export const sceneGoals = computed(() => new Map([...wantedGoals.value, ...teamGoals.value]))

/** Most pressing first: paused, waiting on the operator, running, waiting for its turn, an office
 *  life moment, else what its dot says (free when it shows none). */
export function actorNowOf(sim: SimView, actor: ActorId): ActorNow {
  const goals = sceneGoals.value
  const agentId = ownAgentIdOf(actor)

  if (agentId !== undefined && agents.value.some((agent) => agent.id === agentId && agent.paused)) {
    return { kind: 'paused' }
  }

  const asked = pending.value.find((entry) => holderOf(goals, entry) === actor)

  if (asked !== undefined) {
    return { kind: 'asking', what: askedWhatOf(asked), isAtDesk: isAtDesk(goals.get(actor)) }
  }

  const run = actorRunOf(actor)

  if (run !== undefined) {
    return { kind: 'busy', run }
  }

  return queuedOf(actor) ?? restingOf(sim, actor)
}

/** The run behind what a person does now, while the page holds it. */
export function actorRunOf(actor: ActorId): Run | undefined {
  const runId = sceneGoals.value.get(actor)?.runId

  return runId === undefined ? undefined : findRun(runId)
}

function isAtDesk(goal: Goal | undefined): boolean {
  return goal?.requestId !== undefined
}

// An approval by the tool's own label; a question by the run that asks it.
function askedWhatOf(entry: PendingWire): string {
  if (entry.kind === APPROVAL_KIND) {
    return entry.event.approval?.label ?? ''
  }

  const run = findRun(entry.runId)

  return run === undefined ? cutText(entry.question) : formatRunName(run)
}

// A question the chat sent that waits behind the answer under way, on whoever the chat talks to.
function queuedOf(actor: ActorId): ActorNow | undefined {
  const agentId = selectedAgentId.value
  const target = agentId === undefined ? ASSISTANT : ownActorIdOf(agentId)
  const turn = thread.value.find((held) => held.kind === 'ask' && held.status === 'queued')

  return turn === undefined || target !== actor
    ? undefined
    : { kind: 'queued', what: cutText(turn.text) }
}

function restingOf(sim: SimView, actor: ActorId): ActorNow {
  const life = sim.life.lines.find((line) => line.actor === actor)

  if (life !== undefined) {
    return { kind: 'life', line: lifeTextOf(life) }
  }

  return { kind: 'dot', status: sim.actors.find((held) => held.id === actor)?.status ?? 'free' }
}

function cutText(text: string): string {
  return text.length <= QUEUED_TEXT_MAX
    ? text
    : `${text.slice(0, QUEUED_TEXT_MAX - TRUNCATION_MARK.length).trimEnd()}${TRUNCATION_MARK}`
}
