import { computed } from '@preact/signals'

import type { ActorId, Rect, SimView } from '@/web/scene/types'
import { ownAgentIdOf } from '@/web/scene/sim/actors/roster'
import { teamGoalsFor } from '@/web/scene/sim/team/goals'
import { DESK_SLOTS, TEAM_FLOOR } from '@/web/scene/world/floors'
import { agents } from '@/web/state/agents'
import { runs } from '@/web/state/live'

/** An own agent's card, its box in CSS px of the scene host, and how far it is scaled with zoom. */
export interface CardPlace {
  readonly agentId: string
  readonly actor: ActorId
  readonly rect: Rect
  readonly zoom: number
  /** Its child agents still working, and those carrying their answer back. */
  readonly kidsOpen: number
  readonly kidsBack: number
}

/** A card's box at floor zoom, in CSS px; it grows with the zoom. */
export const CARD_W_PX = 150
export const CARD_H_PX = 74
// The card stands this far over its agent's head.
const CARD_GAP_PX = 4
// "+ Thêm agent" covers the free desk and its chair, from the desk top's corner.
const ADD_DESK_INSET = 4
const ADD_DESK_RISE = 14
const ADD_DESK_W = 48
const ADD_DESK_H = 40

/** Who on the team floor works on which run, as the vocabulary's goals word the office's crew. */
export const teamGoals = computed(() => teamGoalsFor(runs.value, agents.value))

/** One card over each own agent's head on the team floor, scaled with the zoom, never over a
 *  head: its bottom edge sits above the figure's top. */
export function cardPlacesOf(
  sim: SimView,
  at: { readonly figures: ReadonlyMap<ActorId, Rect>; readonly zoom: number }
): readonly CardPlace[] {
  if (sim.floor !== TEAM_FLOOR) {
    return []
  }

  return [...at.figures].flatMap(([actor, figure]) => {
    const agentId = ownAgentIdOf(actor)
    const w = CARD_W_PX * at.zoom
    const h = CARD_H_PX * at.zoom

    if (agentId === undefined) {
      return []
    }

    const rect = { x: figure.x + figure.w / 2 - w / 2, y: figure.y - CARD_GAP_PX - h, w, h }
    const desk = sim.team.desks.find((held) => held.agentId === agentId)
    const kids = { kidsOpen: desk?.kidsOpen ?? 0, kidsBack: desk?.kidsBack ?? 0 }

    return [{ agentId, actor, rect, zoom: at.zoom, ...kids }]
  })
}

/** The role a child's parent gave it, when `actor` is a child on the floor shown. */
export function kidRoleIn(sim: SimView, actor: ActorId): string | undefined {
  return sim.team.kids.find((kid) => kid.actor === actor)?.role
}

/** On the team floor every child wears its tag and every own agent its card instead. */
export function isTeamTagged(sim: SimView, actor: ActorId): boolean {
  return sim.floor === TEAM_FLOOR && kidRoleIn(sim, actor) !== undefined
}

/** The team floor is one room that always fits: everyone's lines show there. */
export function isTeamFloor(sim: SimView): boolean {
  return sim.floor === TEAM_FLOOR
}

/** The next desk nobody sits at, where "+ Thêm agent" stands, in world px; none on an empty
 *  floor (its templates say it) or once every desk is taken. */
export function addDeskOf(sim: SimView): Rect | undefined {
  const desks = sim.team.desks
  const free = desks.find((desk) => desk.agentId === undefined && !desk.isTaken)
  const slot = free === undefined ? undefined : DESK_SLOTS[free.slot]

  if (
    !isTeamFloor(sim) ||
    slot === undefined ||
    !desks.some((desk) => desk.agentId !== undefined)
  ) {
    return undefined
  }

  return {
    x: slot.x - ADD_DESK_INSET,
    y: slot.y - ADD_DESK_RISE,
    w: ADD_DESK_W,
    h: ADD_DESK_H,
  }
}
