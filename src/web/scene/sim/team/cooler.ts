import type { CoolerOffer } from '@/web/scene/data/team-calls'
import type { Member } from '@/web/scene/sim/team/members'
import { sendTo } from '@/web/scene/sim/team/members'
import { addLine, agentMemberOf, isFree, type TeamState } from '@/web/scene/sim/team/state'
import { COOLER_SPOTS } from '@/web/scene/world/seats'
import { setCapped } from '@/web/state/capped-map'

/** Each pair of calls is talked over once; past this many pairs the oldest is forgotten. */
const MAX_COOLER_PAIRS = 100
// How long the two stand at the cooler once both have said their call.
const COOLER_TALK_MS = 6_000

/** Two agents with differing calls on one name walk to the cooler, only while both are free and
 *  never twice for one pair of calls. A busy pair is not called over; a later idea may ask again. */
export function tryTalk(state: TeamState, offer: CoolerOffer | undefined): void {
  if (offer === undefined || state.talk !== undefined || state.talked.has(offer.key)) {
    return
  }

  const a = agentMemberOf(state, offer.mine.agentId)
  const b = agentMemberOf(state, offer.theirs.agentId)
  const [spotA, spotB] = COOLER_SPOTS

  if (a === undefined || b === undefined || !isFree(state, a) || !isFree(state, b)) {
    return
  }

  setCapped(state.talked, [offer.key, true], MAX_COOLER_PAIRS)
  state.talk = { offer, a: a.id, b: b.id, isSpoken: false }
  a.face = b.id
  b.face = a.id
  sendTo(a, 'cooler', spotA.at)
  sendTo(b, 'cooler', spotB.at)
}

/** Once both stand at the cooler, each says its call off the stored rows. */
export function arriveAtCooler(state: TeamState, nowMs: number): void {
  const talk = state.talk
  const a = talk === undefined ? undefined : state.members.get(talk.a)
  const b = talk === undefined ? undefined : state.members.get(talk.b)

  if (talk === undefined || talk.isSpoken || !isStanding(a) || !isStanding(b)) {
    return
  }

  talk.isSpoken = true
  addLine(state, { actor: a.id, say: { kind: 'cooler-mine', call: talk.offer.mine.call } }, nowMs)
  addLine(
    state,
    { actor: b.id, say: { kind: 'cooler-theirs', call: talk.offer.theirs.call } },
    nowMs
  )
  a.taskUntil = nowMs + COOLER_TALK_MS
  b.taskUntil = nowMs + COOLER_TALK_MS
}

/** The talk is over once neither stands at the cooler any more; when one of the two left the
 *  roster meanwhile, it ends at once and the other goes home. */
export function closeTalk(state: TeamState): void {
  const talk = state.talk

  if (talk === undefined) {
    return
  }

  const pair = [state.members.get(talk.a), state.members.get(talk.b)]
  const isBroken = pair.some((member) => member === undefined)

  if (isBroken) {
    for (const member of pair) {
      if (member?.task === 'cooler') {
        member.face = undefined
        sendTo(member, 'home', member.seat.at)
      }
    }
  }

  if (isBroken || pair.every((member) => member?.task !== 'cooler')) {
    state.talk = undefined
  }
}

function isStanding(member: Member | undefined): member is Member {
  return member?.task === 'cooler' && member.isArrived
}
