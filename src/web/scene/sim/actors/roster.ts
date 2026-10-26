import type { ActorId, FloorId, RoleId, RoomId } from '@/web/scene/types'
import { SEATS, type Seat, STATIONS } from '@/web/scene/world/seats'

/** One built-in person: who they are, where they work and the seat they return to. The renderers
 *  resolve their look. */
export interface ActorDef {
  readonly id: ActorId
  readonly role: RoleId
  readonly floor: FloorId
  readonly room: RoomId
  readonly seat: Seat
}

/** The operator's assistant: the one person every chat turn without an agent belongs to. */
export const ASSISTANT: ActorId = 'assistant'
// The operator's own agents and the temporary children runs start join the crew under these.
const OWN_PREFIX = 'agent:'
const KID_PREFIX = 'kid:'

const [BULL_SEAT, PM_SEAT, BEAR_SEAT, ANALYST_SEAT, VERIFIER_SEAT, TRADER_SEAT, RISK_SEAT] =
  SEATS.meet
const [LEFT_DESK, MIDDLE_DESK, RIGHT_DESK] = SEATS.lib
const [ASSISTANT_DESK] = SEATS.assist

/** The office's own crew, room by room: the meeting table, the library, the store, the assistant's
 *  room and the alert desk. */
export const ROSTER: readonly ActorDef[] = Object.freeze(
  [
    office({ id: 'bull', role: 'bull-researcher', room: 'meet' }, BULL_SEAT),
    office({ id: 'pm', role: 'portfolio-manager', room: 'meet' }, PM_SEAT),
    office({ id: 'bear', role: 'bear-researcher', room: 'meet' }, BEAR_SEAT),
    office({ id: 'analyst', role: 'market-analyst', room: 'meet' }, ANALYST_SEAT),
    office({ id: 'verifier', role: 'claim-verifier', room: 'meet' }, VERIFIER_SEAT),
    office({ id: 'trader', role: 'trader', room: 'meet' }, TRADER_SEAT),
    office({ id: 'risk', role: 'risk-analyst', room: 'meet' }, RISK_SEAT),
    office({ id: 'planner', role: 'planner', room: 'lib' }, STATIONS['lib-board']),
    office({ id: 'crawler-1', role: 'crawler', room: 'lib' }, LEFT_DESK),
    office({ id: 'crawler-2', role: 'crawler', room: 'lib' }, RIGHT_DESK),
    office({ id: 'synth', role: 'synth', room: 'lib' }, MIDDLE_DESK),
    office({ id: 'reviewer', role: 'reviewer', room: 'lib' }, STATIONS['lib-review']),
    office({ id: 'theme', role: 'theme', room: 'lib' }, STATIONS['lib-theme']),
    office({ id: 'keeper', role: 'keeper', room: 'store' }, STATIONS.store),
    office({ id: ASSISTANT, role: 'assistant', room: 'assist' }, ASSISTANT_DESK),
    office({ id: 'clerk', role: 'clerk', room: 'alerts' }, STATIONS.alerts),
  ].filter((def): def is ActorDef => def !== undefined)
)

function office(
  who: { readonly id: ActorId; readonly role: RoleId; readonly room: RoomId },
  seat: Seat | undefined
): ActorDef | undefined {
  return seat === undefined ? undefined : { ...who, floor: 'office', seat }
}

/** The person an own agent is in the office. */
export function ownActorIdOf(agentId: string): ActorId {
  return `${OWN_PREFIX}${agentId}`
}

/** The person a temporary child agent's run is in the office. */
export function kidActorIdOf(runId: string): ActorId {
  return `${KID_PREFIX}${runId}`
}

/** The own agent a person stands for; absent for anyone else. */
export function ownAgentIdOf(actor: string): string | undefined {
  return actor.startsWith(OWN_PREFIX) ? actor.slice(OWN_PREFIX.length) : undefined
}

/** `id` names a temporary child agent. */
export function isKidActorId(id: string): boolean {
  return id.startsWith(KID_PREFIX)
}

/** `id` names someone in the office: a built-in person, an own agent or a child. */
export function isActorId(id: string): id is ActorId {
  return id.startsWith(OWN_PREFIX) || isKidActorId(id) || rosterDefOf(id) !== undefined
}

/** The built-in person `id` names; absent for an own agent, a child or no one. */
export function rosterDefOf(id: string): ActorDef | undefined {
  return ROSTER.find((def) => def.id === id)
}
