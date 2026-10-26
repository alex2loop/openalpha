import type { PendingWire, ProgressWire } from '@/app/server/wire/live'
import type { Orphan } from '@/web/scene/sim/assistant'
import type { ActorId, HeldItem, Point, PoseId, RoomId } from '@/web/scene/types'
import type { PropKind } from '@/web/scene/world/props'
import { FETCH_ACTIVITY_PREFIX, QUESTION_ACTIVITY_KEY } from '@/web/scene/data/desk-reads'
import { roomOfRun } from '@/web/scene/data/room-status'
import { DESK_WAIT_SPOTS } from '@/web/scene/world/seats'
import { pendingRequestId, type Run } from '@/web/state/live'

/** What a person is after. A `work` goal always carries the `runId` behind it; `idle` and `life`
 *  never do and never aim at a work object. `target` is a place, a kind of prop (the nearest free
 *  one), or any other text: the person's own seat, about that. `stage` names the vocabulary row,
 *  `requestId` the approval or question a desk walk waits on. */
export interface Goal {
  readonly kind: 'work' | 'idle' | 'life'
  readonly target: string | PropKind | Point
  readonly pose: PoseId
  readonly face?: ActorId
  /** A place the person turns toward (the lobby screens at the bell). */
  readonly look?: Point
  readonly runId?: string
  readonly since: number
  readonly item?: HeldItem
  readonly hasSheet?: true
  readonly stage?: string
  readonly requestId?: string
}

/** One person's part in a row: at its seat or at the nearest prop of a kind, in a pose. */
interface Cast {
  readonly actor: ActorId
  readonly at?: PropKind
  readonly pose: PoseId
  readonly face?: ActorId
  readonly item?: HeldItem
  readonly hasSheet?: true
}

/** A row matches a progress key that starts with `key`; the first matching row wins. */
interface VocabRow {
  readonly key: string
  readonly cast: readonly Cast[]
}

const SEAT_TARGET = 'seat'
const STAGE_DETAIL_KEY = 'progress.researchStageDetail'
const CRAWLERS: readonly ActorId[] = ['crawler-1', 'crawler-2']
const CRAWL_ROW_KEY = 'progress.researchStageCrawl'
// The theme analyst works the library apart from the research crew: its own queue.
const THEMES_KEY_PREFIX = 'trading.progress.themes.'

const typing = (actor: ActorId, extra: Partial<Cast> = {}): Cast => ({
  actor,
  pose: 'type',
  ...extra,
})
const CRAWL_CAST: readonly Cast[] = CRAWLERS.map((actor) => typing(actor))

/** The one table from real progress to who does what; a key no row matches puts the room's lead
 *  at its desk, typing. */
const VOCABULARY: readonly VocabRow[] = Object.freeze([
  { key: 'trading.progress.suggestion.shared', cast: [{ actor: 'analyst', pose: 'idle' }] },
  {
    key: 'trading.progress.suggestion.persist',
    cast: [{ actor: 'pm', at: 'results-board', pose: 'carry', hasSheet: true }],
  },
  { key: 'trading.progress.suggestion.', cast: [typing('analyst')] },
  {
    key: 'trading.progress.debate.cases',
    cast: [
      { actor: 'bull', pose: 'chat', face: 'bear' },
      { actor: 'bear', pose: 'chat', face: 'bull' },
    ],
  },
  { key: 'trading.progress.debate.synthesis', cast: [{ actor: 'pm', pose: 'lean-back' }] },
  {
    key: 'trading.progress.debate.plan',
    cast: [
      typing('trader'),
      typing('risk', { item: 'calculator' }),
      { actor: 'verifier', pose: 'glance', hasSheet: true },
    ],
  },
  { key: 'trading.progress.debate.analysis', cast: [typing('analyst')] },
  { key: 'trading.progress.debate.verification', cast: [typing('verifier')] },
  { key: 'progress.researchStagePlan', cast: [{ actor: 'planner', pose: 'hand', item: 'card' }] },
  { key: CRAWL_ROW_KEY, cast: CRAWL_CAST },
  { key: 'progress.researchQuestion', cast: CRAWL_CAST },
  { key: 'progress.researchStageReview', cast: [typing('reviewer', { item: 'pen' })] },
  { key: 'progress.researchReviewFollowup', cast: [typing('reviewer', { item: 'pen' })] },
  {
    key: 'progress.researchStageSynthesizeComplete',
    cast: [{ actor: 'synth', at: 'printer', pose: 'reach' }],
  },
  { key: 'progress.researchStageSynthesize', cast: [typing('synth')] },
  { key: 'trading.progress.refresh', cast: [{ actor: 'keeper', at: 'box', pose: 'carry' }] },
  { key: 'trading.progress.brief.', cast: [typing('pm')] },
  { key: THEMES_KEY_PREFIX, cast: [typing('theme')] },
] satisfies VocabRow[])

// Who carries a room's run when its step has no row: the room's lead.
const ROOM_LEADS: Readonly<Partial<Record<RoomId, ActorId>>> = Object.freeze({
  meet: 'analyst',
  lib: 'planner',
  store: 'keeper',
  assist: 'assistant',
})
// A run the room table does not place, placed by the family of its progress keys.
const KEY_ROOMS: readonly (readonly [string, RoomId])[] = Object.freeze([
  [THEMES_KEY_PREFIX, 'lib'],
  ['progress.research', 'lib'],
])
const THEMES_CREW = 'themes'
// A child of a child of ... is followed up this far to its top run.
const MAX_RUN_DEPTH = 8
// The assistant already sits nearest your desk, so it never walks there.
const DESK_WALKERS_EXCLUDED: ReadonlySet<ActorId> = new Set(['assistant'])

/** Every goal the live store calls for: each crew's focus run (its oldest) drives the crew, and
 *  a run waiting on the operator sends its actor to your desk. Pure: the same store gives the
 *  same goals, so a reconnect duplicates no one. */
export function goalsFor(
  runs: readonly Run[],
  pending: readonly PendingWire[]
): ReadonlyMap<ActorId, Goal> {
  const goals = new Map<ActorId, Goal>()

  for (const focus of focusRuns(runs)) {
    for (const [actor, goal] of runGoals(focus.run, focus.room)) {
      goals.set(actor, goal)
    }
  }

  addDeskGoals(goals, pending)

  return goals
}

/** The pending requests no one in `goals` stands for: a queued run's, or one from a run the
 *  office does not draw. A request of the assistant's own run is its own. */
export function orphansOf(
  goals: ReadonlyMap<ActorId, Goal>,
  pending: readonly PendingWire[]
): readonly Orphan[] {
  const drawn = new Set([...goals.values()].map((goal) => goal.runId))
  const orphans: Orphan[] = []

  for (const entry of pending) {
    const runId = runIdOf(entry)
    const requestId = pendingRequestId(entry)

    if (runId !== undefined && requestId !== undefined && !drawn.has(runId)) {
      orphans.push({ requestId, runId })
    }
  }

  return orphans
}

// The room a run's crew works in. A top-level run goes by its name, else by its progress keys;
// a child run (a debate role, a delegated agent) by its own keys, else its top run's room. A
// hidden run with no parent has none.
function crewRoomOf(run: Run, index: ReadonlyMap<string, Run>): RoomId | undefined {
  if (run.hidden === true && run.parentRunId === undefined) {
    return undefined
  }

  const key = effectiveKey(run.progress)
  const byKey = KEY_ROOMS.find(([prefix]) => key?.startsWith(prefix) === true)?.[1]

  if (run.parentRunId === undefined) {
    return roomOfRun(run) ?? byKey
  }

  const top = topRunOf(run, index)

  return byKey ?? (top === undefined ? undefined : roomOfRun(top))
}

function topRunOf(run: Run, index: ReadonlyMap<string, Run>): Run | undefined {
  let current: Run | undefined = run

  for (let depth = 0; depth < MAX_RUN_DEPTH && current?.parentRunId !== undefined; depth++) {
    current = index.get(current.parentRunId)
  }

  return current?.parentRunId === undefined ? current : undefined
}

/** The vocabulary row a progress line falls in, if any. */
function rowOf(progress: ProgressWire | undefined): VocabRow | undefined {
  const key = effectiveKey(progress)

  return key === undefined ? undefined : VOCABULARY.find((row) => key.startsWith(row.key))
}

// The oldest run of each crew; the others wait their turn (the room tag says so).
function focusRuns(runs: readonly Run[]): { readonly run: Run; readonly room: RoomId }[] {
  const index = new Map(runs.map((run) => [run.runId, run]))
  const byCrew = new Map<string, { readonly run: Run; readonly room: RoomId }>()

  for (const run of runs) {
    const room = crewRoomOf(run, index)
    const crew = room === undefined ? undefined : crewOf(run, room)
    const held = crew === undefined ? undefined : byCrew.get(crew)

    if (
      crew !== undefined &&
      room !== undefined &&
      (held === undefined || run.startedAt < held.run.startedAt)
    ) {
      byCrew.set(crew, { run, room })
    }
  }

  return [...byCrew.values()]
}

function crewOf(run: Run, room: RoomId): string {
  return effectiveKey(run.progress)?.startsWith(THEMES_KEY_PREFIX) === true ? THEMES_CREW : room
}

function runGoals(run: Run, room: RoomId): (readonly [ActorId, Goal])[] {
  const row = rowOf(run.progress)
  const since = run.progress?.at ?? run.startedAt
  const label = run.title ?? run.name

  if (row === undefined) {
    const lead = ROOM_LEADS[room]

    return lead === undefined
      ? []
      : [[lead, { kind: 'work', target: label, pose: 'type', runId: run.runId, since }]]
  }

  return castOf(row, run.progress).map((cast) => [
    cast.actor,
    {
      kind: 'work',
      target: cast.at ?? label,
      pose: cast.pose,
      runId: run.runId,
      since,
      stage: row.key,
      ...(cast.face === undefined ? {} : { face: cast.face }),
      ...(cast.item === undefined ? {} : { item: cast.item }),
      ...(cast.hasSheet === undefined ? {} : { hasSheet: cast.hasSheet }),
    },
  ])
}

// A question's own activity picks one scout: a search types at its computer, a fetch reads at
// the shelf. Two scouts take every question in turn; more questions queue, never more bodies.
function castOf(row: VocabRow, progress: ProgressWire | undefined): readonly Cast[] {
  if (progress?.key !== QUESTION_ACTIVITY_KEY) {
    return row.cast
  }

  const scout = scoutOf(progress)
  const activity = keyOf(progress.params?.activity)

  if (scout === undefined || activity === undefined) {
    return row.cast
  }

  const busy: Cast = activity.startsWith(FETCH_ACTIVITY_PREFIX)
    ? { actor: scout, at: 'shelf', pose: 'reach' }
    : typing(scout)

  return row.cast.map((cast) => (cast.actor === scout ? busy : cast))
}

/** The scout a question's step belongs to: two scouts take the questions in turn. */
export function scoutOf(progress: ProgressWire): ActorId | undefined {
  const index = toNumber(progress.params?.index)

  return index === undefined ? undefined : CRAWLERS[(index - 1) % CRAWLERS.length]
}

function addDeskGoals(goals: Map<ActorId, Goal>, pending: readonly PendingWire[]): void {
  let spot = 0

  for (const entry of pending) {
    const runId = runIdOf(entry)
    const requestId = pendingRequestId(entry)
    const holder = [...goals].find(([, held]) => held.runId === runId)
    const at = DESK_WAIT_SPOTS.agents[spot]

    if (holder === undefined || requestId === undefined || DESK_WALKERS_EXCLUDED.has(holder[0])) {
      continue
    }

    const [actor, goal] = holder

    goals.set(actor, {
      kind: 'work',
      target: at ?? SEAT_TARGET,
      pose: 'hand',
      ...(runId === undefined ? {} : { runId }),
      since: askedAtOf(entry) ?? goal.since,
      hasSheet: true,
      requestId,
    })
    spot++
  }
}

/** Who stands for a waiting request: the person walking it to your desk, else the person working
 *  its run (the assistant answers its own chat runs at its seat). An orphan has none. */
export function holderOf(
  goals: ReadonlyMap<ActorId, Goal>,
  entry: PendingWire
): ActorId | undefined {
  const requestId = pendingRequestId(entry)
  const runId = runIdOf(entry)
  const all = [...goals]

  return (
    all.find(([, goal]) => requestId !== undefined && goal.requestId === requestId)?.[0] ??
    all.find(([, goal]) => runId !== undefined && goal.runId === runId)?.[0]
  )
}

function runIdOf(entry: PendingWire): string | undefined {
  return entry.kind === 'approval' ? entry.event.runId : entry.runId
}

/** When the request was asked (epoch ms), if the wire says. */
export function askedAtOf(entry: PendingWire): number | undefined {
  return entry.kind === 'approval' ? entry.event.approval?.askedAt : entry.askedAt
}

// A stage line wraps its stage in `progress.researchStageDetail`; the stage's own key is inside.
function effectiveKey(progress: ProgressWire | undefined): string | undefined {
  if (progress === undefined) {
    return undefined
  }

  return progress.key === STAGE_DETAIL_KEY
    ? (keyOf(progress.params?.stage) ?? progress.key)
    : progress.key
}

function keyOf(value: unknown): string | undefined {
  return typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    typeof value.key === 'string'
    ? value.key
    : undefined
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}
