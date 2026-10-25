import type { FloorId, PaperView, Point } from '@/web/scene/types'
import { TRAY_AT } from '@/web/scene/world/seats'

/** Sheets in flight: a handoff at each stage change, a delivered result to the tray. */
export interface Papers {
  /** Starts a flight at `nowMs`; past `MAX_PAPERS` the oldest lands at once. */
  launch(
    flight: { readonly floor: FloorId; readonly from: Point; readonly to: Point },
    nowMs: number
  ): void
  /** Moves every sheet to `nowMs` and drops the ones that landed; true while any flies. */
  step(nowMs: number): boolean
  views(): readonly PaperView[]
  /** Sheets still on their way to the tray, not yet on its stack. */
  flyingToTray(): number
  clear(): void
}

interface Flight {
  readonly floor: FloorId
  readonly from: Point
  readonly to: Point
  readonly startedAt: number
  readonly durationMs: number
  prevK: number
  k: number
}

const MAX_PAPERS = 12
const HANDOFF_MS = 900
const TRAY_FLIGHT_MS = 1_100
// A sheet leaves from about the hands of the person handing it over.
const HAND_RISE_PX = 20

export function createPapers(): Papers {
  let flights: Flight[] = []

  return {
    launch(flight, nowMs) {
      const isToTray = flight.to === TRAY_AT
      const from = { x: flight.from.x, y: flight.from.y - HAND_RISE_PX }
      const to = isToTray ? flight.to : { x: flight.to.x, y: flight.to.y - HAND_RISE_PX }
      const durationMs = isToTray ? TRAY_FLIGHT_MS : HANDOFF_MS

      flights = [
        ...flights,
        { ...flight, from, to, startedAt: nowMs, durationMs, prevK: 0, k: 0 },
      ].slice(-MAX_PAPERS)
    },
    step(nowMs) {
      for (const flight of flights) {
        flight.prevK = flight.k
        flight.k = Math.min(1, (nowMs - flight.startedAt) / flight.durationMs)
      }

      flights = flights.filter((flight) => flight.prevK < 1)

      return flights.length > 0
    },
    views: () => flights,
    flyingToTray: () => flights.filter((flight) => flight.to === TRAY_AT).length,
    clear() {
      flights = []
    },
  }
}
