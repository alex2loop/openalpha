import { SMALL_MOTION_RENDERS_PER_S } from '@/web/scene/budgets'

const SIM_STEP_MS = 100
const MAX_FRAME_DT_MS = 250
const MS_PER_SECOND = 1_000
const SMALL_MOTION_GAP_MS = MS_PER_SECOND / SMALL_MOTION_RENDERS_PER_S
// A deadline already due still waits one step, so a sim that keeps reporting one cannot spin.
const MIN_IDLE_WAIT_MS = SIM_STEP_MS

interface SimLoopDeps {
  /** Advances the sim one fixed step; true while something changed or walks. */
  readonly step: (index: number) => boolean
  /** Draws the snapshot `alpha` of a step past the last one; true while small motion is on. */
  readonly draw: (alpha: number, now: number) => boolean
  /** Re-derives the sim from the clock and the live store after a hidden spell; never replays. */
  readonly resume: () => void
  /** The next pending deadline as a `performance.now()` instant; `Infinity` when none is. */
  readonly nextDueAt: () => number
}

interface SimLoop {
  start(): void
  stop(): void
  /** Something outside the sim changed: draw at once and step again. */
  wake(): void
}

// One loop's mutable state; `listeners` is set exactly while it is started.
interface LoopState {
  readonly deps: SimLoopDeps
  listeners: AbortController | undefined
  frameId: number | undefined
  timer: ReturnType<typeof setTimeout> | undefined
  index: number
  accMs: number
  lastFrameAt: number | undefined
  lastDrawAt: number
  isIdle: boolean
  isDirty: boolean
  isAnimating: boolean
}

/** Fixed steps under an accumulator, frames only while something moves, small motion at a capped
 *  rate, and one timeout to the next deadline while nothing moves. A hidden tab runs nothing. */
export function createSimLoop(deps: SimLoopDeps): SimLoop {
  const loop: LoopState = {
    deps,
    listeners: undefined,
    frameId: undefined,
    timer: undefined,
    index: 0,
    accMs: 0,
    lastFrameAt: undefined,
    lastDrawAt: Number.NEGATIVE_INFINITY,
    isIdle: true,
    isDirty: false,
    isAnimating: false,
  }

  return {
    start: () => start(loop),
    stop: () => stop(loop),
    wake: () => wake(loop),
  }
}

function start(loop: LoopState): void {
  if (loop.listeners !== undefined) {
    return
  }

  loop.listeners = new AbortController()
  document.addEventListener('visibilitychange', () => onVisibility(loop), {
    signal: loop.listeners.signal,
  })
  wake(loop)
}

function stop(loop: LoopState): void {
  loop.listeners?.abort()
  loop.listeners = undefined
  halt(loop)
}

function wake(loop: LoopState): void {
  if (loop.listeners === undefined || document.hidden) {
    return
  }

  loop.isDirty = true

  if (loop.frameId !== undefined) {
    return
  }

  // Back from rest the first frame steps at once, from a fresh frame time.
  if (loop.isIdle) {
    loop.isIdle = false
    loop.lastFrameAt = undefined
    loop.accMs = SIM_STEP_MS
  }

  requestFrame(loop)
}

function frame(loop: LoopState, now: number): void {
  loop.frameId = undefined

  const isMoving = advance(loop, now)
  const isDrawDue = loop.isAnimating && now - loop.lastDrawAt >= SMALL_MOTION_GAP_MS

  if (isMoving || loop.isDirty || isDrawDue) {
    loop.isAnimating = loop.deps.draw(loop.accMs / SIM_STEP_MS, now)
    loop.lastDrawAt = now
    loop.isDirty = false
  }

  if (isMoving) {
    requestFrame(loop)
  } else if (loop.isAnimating) {
    armTimer(loop, loop.lastDrawAt + SMALL_MOTION_GAP_MS - now, () => requestFrame(loop))
  } else {
    rest(loop)
  }
}

function advance(loop: LoopState, now: number): boolean {
  const last = loop.lastFrameAt
  let isMoving = false

  loop.lastFrameAt = now
  loop.accMs += last === undefined ? 0 : Math.min(now - last, MAX_FRAME_DT_MS)

  while (loop.accMs >= SIM_STEP_MS) {
    loop.accMs -= SIM_STEP_MS
    isMoving = loop.deps.step(loop.index) || isMoving
    loop.index++
  }

  return isMoving
}

function rest(loop: LoopState): void {
  loop.isIdle = true

  const waitMs = loop.deps.nextDueAt() - performance.now()

  if (Number.isFinite(waitMs)) {
    armTimer(loop, Math.max(MIN_IDLE_WAIT_MS, waitMs), () => wake(loop))
  }
}

function onVisibility(loop: LoopState): void {
  if (document.hidden) {
    halt(loop)
    return
  }

  loop.deps.resume()
  wake(loop)
}

function halt(loop: LoopState): void {
  clearTimer(loop)

  if (loop.frameId !== undefined) {
    cancelAnimationFrame(loop.frameId)
    loop.frameId = undefined
  }

  loop.isIdle = true
}

function requestFrame(loop: LoopState): void {
  clearTimer(loop)
  loop.frameId = requestAnimationFrame((now) => frame(loop, now))
}

function armTimer(loop: LoopState, delayMs: number, run: () => void): void {
  clearTimer(loop)
  loop.timer = setTimeout(run, delayMs)
}

function clearTimer(loop: LoopState): void {
  clearTimeout(loop.timer)
  loop.timer = undefined
}
