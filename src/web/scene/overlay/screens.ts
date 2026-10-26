import type { SeriesRef } from '@/web/scene/data/desk-reads'
import type { ActorDef } from '@/web/scene/sim/actors/roster'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId, FloorId, Rect, RoomId } from '@/web/scene/types'
import type { Run } from '@/web/state/live'
import { hostOf, seriesKeyOf } from '@/web/scene/data/desk-reads'
import { toParamText } from '@/web/scene/data/room-status'
import { ROSTER } from '@/web/scene/sim/actors/roster'
import { CRAWLERS, scoutOf } from '@/web/scene/sim/vocabulary'
import { propsOn } from '@/web/scene/world/props'

const ANALYST: ActorId = 'analyst'
// A desk's computer stands within this far of its person's seat, in world px.
const SCREEN_REACH_PX = 30
// The computer's stand under its screen.
const STAND_PX = 4
// The analyst works on a laptop on the meeting table, just in front of its seat.
const LAPTOP_W = 14
const LAPTOP_H = 9
const LAPTOP_RISE = 52

/** What a lit screen shows: the host a scout's page read names, or the closes of the ticker the
 *  analyst works on. */
type ScreenContent =
  | { readonly kind: 'host'; readonly host: string }
  | {
      readonly kind: 'line'
      readonly closes: readonly number[]
      readonly ticker: string
      readonly market: string
    }

/** A desk screen lit by its person's run; `rect` is the screen in world px. */
export interface LitScreen {
  readonly actor: ActorId
  readonly runId: string
  readonly floor: FloorId
  readonly room: RoomId
  readonly rect: Rect
  readonly content: ScreenContent
}

interface ScreenInput {
  readonly goals: ReadonlyMap<ActorId, Goal>
  readonly runs: readonly Run[]
  readonly series: ReadonlyMap<string, readonly number[]>
  /** The market the analyst's ticker is read on: the home market (progress names none). */
  readonly market: string | undefined
}

/** Every desk screen with real work on it: a scout's while its question reads a page, the
 *  analyst's once its ticker's closes are read. An idle screen is not listed: it shows nothing. */
export function buildScreens(input: ScreenInput): readonly LitScreen[] {
  const screens: LitScreen[] = []

  for (const def of ROSTER) {
    const content = contentOf(def, input)
    const runId = input.goals.get(def.id)?.runId
    const rect = screenRectOf(def)

    if (content !== undefined && runId !== undefined && rect !== undefined) {
      screens.push({ actor: def.id, runId, floor: def.floor, room: def.room, rect, content })
    }
  }

  return screens
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

function contentOf(def: ActorDef, input: ScreenInput): ScreenContent | undefined {
  const run = workRunOf(def.id, input)

  if (run === undefined) {
    return undefined
  }

  if (CRAWLERS.includes(def.id)) {
    const host = run.progress === undefined ? undefined : hostOf(run.progress)
    const isOwn = run.progress !== undefined && scoutOf(run.progress) === def.id

    return host !== undefined && isOwn ? { kind: 'host', host } : undefined
  }

  const ticker = def.id === ANALYST ? tickerOf(run) : undefined
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

function tickerOf(run: Run): string | undefined {
  return toParamText(run.progress?.params?.ticker) ?? run.tickers[0]
}

// A scout's screen is its desk computer's (the one nearest its seat, less the stand); the
// analyst's is the laptop in front of its seat. Anyone else has no screen of their own.
function screenRectOf(def: ActorDef): Rect | undefined {
  if (def.id === ANALYST) {
    return {
      x: def.seat.at.x - LAPTOP_W / 2,
      y: def.seat.at.y - LAPTOP_RISE,
      w: LAPTOP_W,
      h: LAPTOP_H,
    }
  }

  if (!CRAWLERS.includes(def.id)) {
    return undefined
  }

  const computer = propsOn(def.floor)
    .filter((prop) => prop.kind === 'computer' && prop.room === def.room)
    .map((prop) => ({ prop, gap: Math.abs(prop.draw.x + prop.draw.w / 2 - def.seat.at.x) }))
    .filter(({ gap }) => gap <= SCREEN_REACH_PX)
    .sort((a, b) => a.gap - b.gap)[0]?.prop

  return computer === undefined ? undefined : { ...computer.draw, h: computer.draw.h - STAND_PX }
}
