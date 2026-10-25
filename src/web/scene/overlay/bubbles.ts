import { type ReadonlySignal, signal } from '@preact/signals'

import type { WireEvent } from '@/app/server/wire/events'
import type { PendingWire } from '@/app/server/wire/live'
import type { PastCall, Recall } from '@/web/scene/data/past-calls'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId } from '@/web/scene/types'
import type { onWireEvent } from '@/web/state/events'
import type { Run } from '@/web/state/live'
import { formatDay, type MessageKey, pluralKey } from '@/i18n'
import { roleNameOf } from '@/web/scene/overlay/name-tags'
import { ROSTER } from '@/web/scene/sim/actors/roster'
import { holderOf } from '@/web/scene/sim/vocabulary'
import { pendingRequestId } from '@/web/state/live'
import { locale } from '@/web/state/session'
import { joinInline, TRUNCATION_MARK } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

/** How long a spoken line stays, unless the speaker's next bubble replaces it first. */
const SPEECH_MS = 8_000
const BUBBLE_MAX_CHARS = 80
// One line per speaker is kept, so this is the roster's size.
const MAX_SAID = 16
const MANAGER: ActorId = 'pm'
const APPROVAL_KIND = 'approval'
// A sentence ends at a stop followed by a space or the end.
const SENTENCE_END_RE = /[.!?](?=\s|$)/u
const ACTION_KEYS = Object.freeze({
  buy: 'trading.action.buy',
  reduce: 'trading.action.reduce',
} satisfies Record<PastCall['action'], MessageKey>)
const OUTCOME_KEYS = Object.freeze({
  target: 'trading.outcome.target',
  stop: 'trading.outcome.stop',
  expired: 'trading.outcome.expired',
} satisfies Record<PastCall['outcome'], MessageKey>)

export type BubbleKind = 'wait' | 'say' | 'think' | 'due' | 'life'

/** One bubble over a person: `text` is cut to fit, `full` is all of it; `untilMs` (a
 *  `performance.now()` instant) is when a spoken line ends. */
export interface Bubble {
  readonly id: string
  readonly actor: ActorId
  readonly kind: BubbleKind
  readonly text: string
  readonly full: string
  readonly footer?: string
  readonly untilMs?: number
}

/** A line heard on the wire: a role's speech, by its actor, or a model switch, by its run.
 *  `heardAt` is epoch ms, `untilMs` a `performance.now()` instant. */
interface Said {
  readonly actor?: ActorId
  readonly runId?: string
  readonly text: string
  readonly footer?: string
  readonly heardAt: number
  readonly untilMs: number
}

interface BubbleInput {
  readonly goals: ReadonlyMap<ActorId, Goal>
  readonly runs: readonly Run[]
  readonly pending: readonly PendingWire[]
  readonly said: readonly Said[]
  readonly recalls: ReadonlyMap<string, Recall>
  /** `performance.now()` and the epoch, read once for the pass. */
  readonly nowMs: number
  readonly epochMs: number
}

/** A bubble before it is chosen: `at` (epoch ms) orders a person's say and think lines. */
interface Candidate {
  readonly actor: ActorId
  readonly kind: BubbleKind
  readonly full: string
  readonly footer?: string
  readonly at: number
  readonly untilMs?: number
}

const saidList = signal<readonly Said[]>([])

/** The lines heard and still kept, newest last. */
export const said: ReadonlySignal<readonly Said[]> = saidList

/** Listens for what roles say and for model switches; the returned stop drops what was heard. */
export function startSpeech(hub: typeof onWireEvent): () => void {
  const offs = [hub('role_output', hearRole), hub('provider_fallback', hearFallback)]

  return () => {
    for (const off of offs) {
      off()
    }

    saidList.value = []
  }
}

function hearRole(event: WireEvent): void {
  const role = event.role
  const def = ROSTER.find((held) => held.role === role?.role)

  if (role === undefined || def === undefined || role.unsupported || role.summary === undefined) {
    return
  }

  const text = firstSentence(role.summary)
  const sources = tr(
    pluralKey(role.citations, 'ui.office.common.sourcesOne', 'ui.office.common.sources'),
    {
      count: role.citations,
    }
  )
  const segments = [roleNameOf(def.role), role.stance, sources].filter(
    (segment): segment is string => segment !== undefined && segment !== ''
  )

  if (text !== '') {
    hear({ actor: def.id, text, footer: joinInline(segments) })
  }
}

function hearFallback(event: WireEvent): void {
  if (event.runId !== undefined) {
    hear({ runId: event.runId, text: tr('ui.office.bubble.modelSwap') })
  }
}

// A speaker's newer line replaces its older one.
function hear(line: Omit<Said, 'heardAt' | 'untilMs'>): void {
  const entry: Said = { ...line, heardAt: Date.now(), untilMs: performance.now() + SPEECH_MS }
  const others = saidList.value.filter(
    (held) => held.actor !== line.actor || held.runId !== line.runId
  )

  saidList.value = [...others, entry].slice(-MAX_SAID)
}

/** Every bubble an event or a stored row stands behind, one per person: a wait over everything,
 *  else the newer of its spoken and its thinking line. */
export function buildBubbles(input: BubbleInput): readonly Bubble[] {
  const chosen = new Map<ActorId, Candidate>()
  const candidates = [...thinkLines(input), ...spokenLines(input), ...waitLines(input)]

  for (const candidate of candidates) {
    const held = chosen.get(candidate.actor)

    if (held === undefined || outranks(candidate, held)) {
      chosen.set(candidate.actor, candidate)
    }
  }

  return [...chosen.values()].map(toBubble)
}

// One per run, on the first person its goals name: the run's step line, or its model's latest
// reasoning when it streams one.
function thinkLines(input: BubbleInput): Candidate[] {
  const byId = new Map(input.runs.map((run) => [run.runId, run]))
  const seen = new Set<string>()
  const lines: Candidate[] = []

  for (const [actor, goal] of input.goals) {
    const run = goal.runId === undefined ? undefined : byId.get(goal.runId)
    const text = run?.thinking ?? run?.progress?.text

    if (run !== undefined && text !== undefined && text !== '' && !seen.has(run.runId)) {
      seen.add(run.runId)
      lines.push({ actor, kind: 'think', full: text, at: run.progress?.at ?? run.startedAt })
    }
  }

  return lines
}

function spokenLines(input: BubbleInput): Candidate[] {
  const lines: Candidate[] = []

  for (const line of input.said) {
    const actor = line.actor ?? actorOfRun(input.goals, line.runId)

    if (actor !== undefined && line.untilMs > input.nowMs) {
      lines.push({ actor, kind: 'say', full: line.text, at: line.heardAt, untilMs: line.untilMs })
    }
  }

  return [...lines, ...recalledLines(input)]
}

// The manager recalls the name's last calls when its debate starts.
function recalledLines(input: BubbleInput): Candidate[] {
  return [...input.recalls.values()].flatMap((recall) => {
    const untilMs = recall.heardAt + SPEECH_MS
    const full = memoryText(recall.calls)

    if (untilMs <= input.nowMs || full === undefined) {
      return []
    }

    return [
      {
        actor: MANAGER,
        kind: 'say' as const,
        full,
        footer: tr('ui.office.bubble.memoryFooter'),
        at: input.epochMs - (input.nowMs - recall.heardAt),
        untilMs,
      },
    ]
  })
}

function memoryText(calls: readonly PastCall[]): string | undefined {
  const [last, before] = calls

  if (last === undefined) {
    return undefined
  }

  const head = tr('ui.office.bubble.memory', {
    action: tr(ACTION_KEYS[last.action]),
    ticker: last.ticker,
    day: formatDay(locale.value, last.day),
    outcome: tr(OUTCOME_KEYS[last.outcome]),
  })

  return before === undefined
    ? head
    : `${head} ${tr('ui.office.bubble.memoryMore', {
        day: formatDay(locale.value, before.day),
        outcome: tr(OUTCOME_KEYS[before.outcome]),
      })}`
}

// An approval waiting on the operator, over the person who brought it.
function waitLines(input: BubbleInput): Candidate[] {
  const lines: Candidate[] = []

  for (const entry of input.pending) {
    const requestId = pendingRequestId(entry)
    const label = entry.kind === APPROVAL_KIND ? entry.event.approval?.label : undefined
    const holder = holderOf(input.goals, entry)

    if (requestId !== undefined && label !== undefined && holder !== undefined) {
      lines.push({
        actor: holder,
        kind: 'wait',
        full: tr('ui.office.bubble.needYou', { label }),
        at: input.epochMs,
      })
    }
  }

  return lines
}

function actorOfRun(
  goals: ReadonlyMap<ActorId, Goal>,
  runId: string | undefined
): ActorId | undefined {
  return runId === undefined ? undefined : [...goals].find(([, goal]) => goal.runId === runId)?.[0]
}

function outranks(next: Candidate, held: Candidate): boolean {
  if (held.kind === 'wait') {
    return false
  }

  return next.kind === 'wait' || next.at >= held.at
}

function toBubble(candidate: Candidate): Bubble {
  const { actor, kind, full, footer, untilMs } = candidate

  return {
    id: `${kind}:${actor}`,
    actor,
    kind,
    text: cut(full),
    full,
    ...(footer === undefined ? {} : { footer }),
    ...(untilMs === undefined ? {} : { untilMs }),
  }
}

function cut(text: string): string {
  if (text.length <= BUBBLE_MAX_CHARS) {
    return text
  }

  return `${text.slice(0, BUBBLE_MAX_CHARS - TRUNCATION_MARK.length).trimEnd()}${TRUNCATION_MARK}`
}

function firstSentence(text: string): string {
  const trimmed = text.trim()
  const end = SENTENCE_END_RE.exec(trimmed)

  return end === null ? trimmed : trimmed.slice(0, end.index + 1)
}
