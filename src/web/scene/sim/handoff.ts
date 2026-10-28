import type { People } from '@/web/scene/sim/people'
import type { ActorId } from '@/web/scene/types'
import { setCapped } from '@/web/state/capped-map'
import { reducedMotion } from '@/web/state/prefs'

// Runs remembered past their end, for the beats their last events play.
const MAX_RUN_MEMORY = 32

// At each stage change of a run, a sheet goes from the people who finished to the people who
// start: one to one, round the shorter list.
export function handOff(people: People, nowMs: number): void {
  const byRun = new Map<string, { stage?: string; actors: ActorId[] }>()

  for (const [actor, goal] of people.wanted) {
    if (goal.runId !== undefined) {
      const held = byRun.get(goal.runId) ?? { actors: [] }

      held.actors.push(actor)
      byRun.set(goal.runId, { ...held, ...(goal.stage === undefined ? {} : { stage: goal.stage }) })
    }
  }

  for (const [runId, current] of byRun) {
    const before = people.stages.get(runId)
    const isNewStage =
      before !== undefined && current.stage !== undefined && before.stage !== current.stage

    if (isNewStage) {
      flyBetween(people, { from: before.actors, to: current.actors }, nowMs)
    }

    setCapped(people.runActors, [runId, current.actors], MAX_RUN_MEMORY)
  }

  people.stages.clear()

  for (const [runId, current] of byRun) {
    if (current.stage !== undefined) {
      people.stages.set(runId, { stage: current.stage, actors: current.actors })
    }
  }
}

function flyBetween(
  people: People,
  pair: { readonly from: readonly ActorId[]; readonly to: readonly ActorId[] },
  nowMs: number
): void {
  const count = reducedMotion.value ? 0 : Math.max(pair.from.length, pair.to.length)

  for (let i = 0; i < count; i++) {
    const fromId = pair.from[i % pair.from.length]
    const toId = pair.to[i % pair.to.length]
    const from = fromId === undefined ? undefined : people.byId.get(fromId)
    const to = toId === undefined ? undefined : people.byId.get(toId)

    if (from !== undefined && to !== undefined && from !== to && from.floor === to.floor) {
      people.papers.launch({ floor: from.floor, from: from.walker.pos, to: to.walker.pos }, nowMs)
    }
  }
}
