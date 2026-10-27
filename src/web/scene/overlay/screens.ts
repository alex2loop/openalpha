import type { SeriesRef } from '@/web/scene/data/desk-reads'
import type { DeskScreenContent } from '@/web/scene/overlay-types'
import type { ActorDef } from '@/web/scene/sim/actors/roster'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId, ActorView, FloorId, Point, Rect, RoomId } from '@/web/scene/types'
import type { PropDef } from '@/web/scene/world/props'
import type { Run } from '@/web/state/live'
import { hostOf, seriesKeyOf } from '@/web/scene/data/desk-reads'
import { runContentOf, terminalLinesOf, tickerOf } from '@/web/scene/data/screen-lines'
import { ROSTER } from '@/web/scene/sim/actors/roster'
import { CRAWLERS, scoutOf } from '@/web/scene/sim/vocabulary'
import { computerAt, flatScreenOf } from '@/web/scene/world/desk-spots'
import { TEAM_FLOOR } from '@/web/scene/world/floors'
import { sceneView } from '@/web/state/prefs'

const ANALYST: ActorId = 'analyst'
// The computer's stand under its screen.
const STAND_PX = 4
// The analyst works on a laptop on the meeting table, just in front of its seat.
const LAPTOP_W = 14
const LAPTOP_H = 9
const LAPTOP_RISE = 52

/** A desk screen lit by its person's run; `rect` is the screen in world px. */
export interface LitScreen {
  readonly actor: ActorId
  readonly runId: string
  readonly floor: FloorId
  readonly room: RoomId
  readonly rect: Rect
  readonly seat: Point
  readonly content: DeskScreenContent
}

interface ScreenInput {
  readonly goals: ReadonlyMap<ActorId, Goal>
  readonly runs: readonly Run[]
  readonly series: ReadonlyMap<string, readonly number[]>
  /** The market the analyst's ticker is read on: the home market (progress names none). */
  readonly market: string | undefined
}

/** Every desk screen with real work on it: a scout's while its question reads a page, the
 *  analyst's once its ticker's closes are read, anyone else's while they work a run. Each shows the
 *  run of the person at it. An idle screen is not listed: it shows nothing. */
export function buildScreens(input: ScreenInput): readonly LitScreen[] {
  const screens: LitScreen[] = []

  for (const def of ROSTER) {
    const content = contentOf(def, input)
    const runId = input.goals.get(def.id)?.runId
    const rect = screenRectOf(def)

    if (content !== undefined && runId !== undefined && rect !== undefined) {
      screens.push({
        actor: def.id,
        runId,
        floor: def.floor,
        room: def.room,
        rect,
        seat: def.seat.at,
        content,
      })
    }
  }

  return screens
}

/** The team floor's screens: an own agent or a child at work at its desk lights the computer in
 *  line with it with the terminal of its own run. */
export function buildTeamScreens(input: {
  readonly floor: FloorId
  readonly actors: readonly ActorView[]
  readonly runs: readonly Run[]
}): readonly LitScreen[] {
  if (input.floor !== TEAM_FLOOR) {
    return []
  }

  return input.actors.flatMap((actor) => {
    const run = input.runs.find((held) => held.runId === actor.runId)
    const computer = actor.working ? computerAt(actor.floor, actor.at) : undefined

    return run === undefined || computer === undefined
      ? []
      : [
          {
            actor: actor.id,
            runId: run.runId,
            floor: actor.floor,
            room: 'team',
            rect: computerScreenOf(computer),
            seat: actor.at,
            content: runContentOf(run),
          },
        ]
  })
}

/** The price line the analyst's work calls for, to read once per run and ticker. */
export function analystSeriesOf(
  input: Omit<ScreenInput, 'series'>,
  day: string
): SeriesRef | undefined {
  const run = workRunOf(ANALYST, input)
  const ticker = run === undefined ? undefined : tickerOf(run)

  if (run === undefined || ticker === undefined || input.market === undefined) {
    return undefined
  }

  return { runId: run.runId, market: input.market, ticker, day }
}

function contentOf(def: ActorDef, input: ScreenInput): DeskScreenContent | undefined {
  const run = workRunOf(def.id, input)

  if (run === undefined) {
    return undefined
  }

  if (def.id === ANALYST) {
    return lineContentOf(run, input)
  }

  return (CRAWLERS.includes(def.id) ? hostContentOf(def, run) : undefined) ?? runContentOf(run)
}

// A scout's screen names the page its own question reads; the other scout's has none.
function hostContentOf(def: ActorDef, run: Run): DeskScreenContent | undefined {
  const host = run.progress === undefined ? undefined : hostOf(run.progress)
  const isOwn = run.progress !== undefined && scoutOf(run.progress) === def.id

  return host !== undefined && isOwn
    ? { kind: 'host', host, lines: terminalLinesOf(run, host) }
    : undefined
}

function lineContentOf(run: Run, input: ScreenInput): DeskScreenContent | undefined {
  const ticker = tickerOf(run)
  const closes =
    ticker === undefined ? undefined : input.series.get(seriesKeyOf({ runId: run.runId, ticker }))

  return ticker === undefined || closes === undefined || input.market === undefined
    ? undefined
    : { kind: 'line', closes, ticker, market: input.market }
}

function workRunOf(actor: ActorId, input: Pick<ScreenInput, 'goals' | 'runs'>): Run | undefined {
  const goal = input.goals.get(actor)

  return goal?.kind === 'work' && goal.runId !== undefined
    ? input.runs.find((run) => run.runId === goal.runId)
    : undefined
}

// A person's screen is the computer they sit in line with, so one two people share lights only for
// the one at it; the analyst's is the laptop in front of the seat. Someone with no computer to sit
// at has none.
function screenRectOf(def: ActorDef): Rect | undefined {
  if (def.id === ANALYST) {
    return {
      x: def.seat.at.x - LAPTOP_W / 2,
      y: def.seat.at.y - LAPTOP_RISE,
      w: LAPTOP_W,
      h: LAPTOP_H,
    }
  }

  const computer = computerAt(def.floor, def.seat.at)

  return computer === undefined ? undefined : computerScreenOf(computer)
}

// 2D lays a worked-at screen flat on the desk; 3D keeps it standing.
function computerScreenOf(computer: PropDef): Rect {
  return sceneView.value === '2d'
    ? flatScreenOf(computer)
    : { ...computer.draw, h: computer.draw.h - STAND_PX }
}
