import { effect, type ReadonlySignal, signal, untracked } from '@preact/signals'

import type { AgentWire } from '@/app/server/wire/agents'
import type { WireEvent } from '@/app/server/wire/events'
import type { SuggestionWire } from '@/app/server/wire/trading'
import type { CoolerCall } from '@/web/scene/types'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { agents, MIN_SHARED_NAMES, SHARED_FOCUS } from '@/web/state/agents'
import { onWireEvent } from '@/web/state/events'
import { firstSentence } from '@/web/text/sentence'

const OPEN_STATUS = 'open'
const ALL_STATUS = 'all'
const ONE_CALL = 1

type IdeaWire = NonNullable<WireEvent['idea']>

/** Two own agents' differing stored calls on one name; `key` names that pair of calls. */
export interface CoolerOffer {
  readonly key: string
  readonly mine: { readonly agentId: string; readonly call: CoolerCall }
  readonly theirs: { readonly agentId: string; readonly call: CoolerCall }
}

interface IdeaAsk {
  readonly mine: AgentWire
  readonly idea: IdeaWire
  readonly others: readonly AgentWire[]
}

const latest = signal<ReadonlyMap<string, SuggestionWire>>(new Map())
const offered = signal<CoolerOffer | undefined>(undefined)

/** Each own agent's latest stored call under its own focus, by agent id; an agent that shares the
 *  operator's focus, or has called nothing yet, has no entry. */
export const latestCalls: ReadonlySignal<ReadonlyMap<string, SuggestionWire>> = latest
/** The newest pair of differing calls two seasoned agents hold on one name. */
export const coolerOffer: ReadonlySignal<CoolerOffer | undefined> = offered

/** Reads each own agent's latest call once, again on its `idea` or `call_scored`, and on an idea
 *  looks for another agent that called the same name the other way. The returned stop is
 *  idempotent and drops every read in flight. */
export function startTeamCalls(): () => void {
  const reads = new AbortController()
  const asked = new Set<string>()
  const stopEffect = effect(() => {
    const roster = agents.value

    untracked(() => readMissing(roster, { asked, signal: reads.signal }))
  })
  const offs = [
    onWireEvent('idea', (event) => onIdea(event, reads.signal)),
    onWireEvent('call_scored', (event) => refreshLatest(event.source.agentId, reads.signal)),
  ]

  return () => {
    reads.abort()
    stopEffect()

    for (const off of offs) {
      off()
    }

    asked.clear()
    latest.value = new Map()
    offered.value = undefined
  }
}

// Only agents on the roster are kept, so both the asked set and the calls stay within its size.
function readMissing(
  roster: readonly AgentWire[],
  scope: { readonly asked: Set<string>; readonly signal: AbortSignal }
): void {
  const ids = new Set(roster.map((agent) => agent.id))

  for (const id of [...scope.asked]) {
    if (!ids.has(id)) {
      scope.asked.delete(id)
    }
  }

  if ([...latest.value.keys()].some((id) => !ids.has(id))) {
    latest.value = new Map([...latest.value].filter(([id]) => ids.has(id)))
  }

  for (const agent of roster) {
    if (!scope.asked.has(agent.id)) {
      scope.asked.add(agent.id)
      readLatest(agent, scope.signal)
    }
  }
}

function onIdea(event: WireEvent, abortSignal: AbortSignal): void {
  refreshLatest(event.source.agentId, abortSignal)

  const roster = agents.value
  const mine = roster.find((agent) => agent.id === event.source.agentId)
  const idea = event.idea

  if (mine === undefined || idea === undefined || !isSeasoned(mine)) {
    return
  }

  const others = roster.filter(
    (agent) => agent.id !== mine.id && agent.focusKey !== SHARED_FOCUS && isSeasoned(agent)
  )

  findOffer({ mine, idea, others }, abortSignal).catch(() => undefined)
}

function refreshLatest(agentId: string, abortSignal: AbortSignal): void {
  const agent = agents.value.find((held) => held.id === agentId)

  if (agent !== undefined) {
    readLatest(agent, abortSignal)
  }
}

// An agent on the operator's focus has no call apart from the plan, so its desk shows none.
function readLatest(agent: AgentWire, abortSignal: AbortSignal): void {
  if (agent.focusKey === SHARED_FOCUS) {
    return
  }

  getJson(ROUTES.suggestions, {
    query: { status: ALL_STATUS, focus: agent.focusKey, limit: ONE_CALL },
    signal: abortSignal,
  })
    .then((read) => {
      const call = read.suggestions[0]

      if (call !== undefined && agents.value.some((held) => held.id === agent.id)) {
        latest.value = new Map([...latest.value, [agent.id, call]])
      }
    })
    // A focus nothing was called under yet is refused: the desk shows no latest call.
    .catch(() => undefined)
}

// The other agents' stored calls on the name, one agent at a time, until one called it the other
// way with a reason it can say.
async function findOffer(ask: IdeaAsk, abortSignal: AbortSignal): Promise<void> {
  const { instrument } = ask.idea

  for (const other of ask.others) {
    const read = await getJson(ROUTES.suggestions, {
      query: {
        status: OPEN_STATUS,
        focus: other.focusKey,
        market: instrument.market,
        ticker: instrument.ticker,
        limit: ONE_CALL,
      },
      signal: abortSignal,
    })
    const theirs = read.suggestions[0]
    const reason = theirs?.thesis === undefined ? '' : firstSentence(theirs.thesis)

    if (theirs !== undefined && theirs.action !== ask.idea.action && reason !== '') {
      offered.value = toOffer(ask, { other, theirs, reason })
      return
    }
  }
}

function toOffer(
  ask: IdeaAsk,
  found: { readonly other: AgentWire; readonly theirs: SuggestionWire; readonly reason: string }
): CoolerOffer {
  const { idea, mine } = ask
  const { other, theirs, reason } = found
  const ticker = idea.instrument.ticker

  return {
    key: `${idea.suggestionId}:${theirs.id}`,
    mine: { agentId: mine.id, call: { agent: mine.name, ticker, action: idea.action } },
    theirs: {
      agentId: other.id,
      call: { agent: other.name, ticker, action: theirs.action, day: theirs.at, reason },
    },
  }
}

// Agreement means something only from `MIN_SHARED_NAMES` shared names; an agent with no record has
// no stored call to stand on.
function isSeasoned(agent: AgentWire): boolean {
  return agent.record !== undefined && (agent.agreement?.comparedCount ?? 0) >= MIN_SHARED_NAMES
}
