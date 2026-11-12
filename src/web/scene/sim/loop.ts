import { SMALL_MOTION_RENDERS_PER_S } from '@/web/scene/budgets'
import { MS_PER_SECOND } from '@/web/text/time-units'

export const SIM_STEP_MS = 100
const MAX_FRAME_DT_MS = 250
const SMALL_MOTION_GAP_MS = MS_PER_SECOND / SMALL_MOTION_RENDERS_PER_S
// A deadline already due still waits one step, so a sim that keeps reporting one cannot spin.
const MIN_IDLE_WAIT_MS = SIM_STEP_MS

/** What one step moved: nothing, only what the stage does not show, or something it shows. */
export type StepMotion = 'still' | 'unseen' | 'seen'

interface SimLoopDeps {
  /** Advances the sim one fixed step. */
  readonly step: (index: number) => StepMotion
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
  /** The stage left the page (a hidden pane) or came back; while it is away nothing runs. */
  show(isShown: boolean): void
  /** The live picture went stale or came back: while held nothing steps; on release the sim is
   *  re-derived from the live store, as after a hidden spell. */
  hold(isHeld: boolean): void
  /** Started, on a visible tab, with the stage shown and not held. */
  isRunning(): boolean
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
  isShown: boolean
  isHeld: boolean
}

/** Fixed steps under an accumulator, frames only while something moves, small motion at a capped
 *  rate, and one timeout to the next deadline while nothing moves. A hidden tab or stage runs
 *  nothing. */
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
    isShown: true,
    isHeld: false,
  }

  return {
    start: () => start(loop),
    stop: () => stop(loop),
    wake: () => wake(loop),
    show: (isShown) => show(loop, isShown),
    hold: (isHeld) => hold(loop, isHeld),
    isRunning: () => isRunning(loop),
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

function show(loop: LoopState, isShown: boolean): void {
  if (isShown === loop.isShown) {
    return
  }

  loop.isShown = isShown

  if (!isShown) {
    halt(loop)
    return
  }

  comeBack(loop)
}

function hold(loop: LoopState, isHeld: boolean): void {
  if (isHeld === loop.isHeld) {
    return
  }

  loop.isHeld = isHeld

  if (isHeld) {
    // One last frame, so what the overlay says about people reads the stale picture.
    halt(loop)
    wake(loop)
    return
  }

  comeBack(loop)
}

// The stage is on a visible tab again, or its hold ended: a held one only draws, a free one is
// re-derived first.
function comeBack(loop: LoopState): void {
  if (!isDrawable(loop)) {
    return
  }

  if (!loop.isHeld) {
    loop.deps.resume()
  }

  wake(loop)
}

function isDrawable(loop: LoopState): boolean {
  return loop.listeners !== undefined && !document.hidden && loop.isShown
}

function isRunning(loop: LoopState): boolean {
  return isDrawable(loop) && !loop.isHeld
}

function wake(loop: LoopState): void {
  if (!isDrawable(loop)) {
    return
  }

  loop.isDirty = true

  if (loop.frameId !== undefined) {
    return
  }

  // Back from rest the first frame steps at once, from a fresh frame time; a held one never steps.
  if (loop.isIdle && !loop.isHeld) {
    loop.isIdle = false
    loop.lastFrameAt = undefined
    loop.accMs = SIM_STEP_MS
  }

  requestFrame(loop)
}

function frame(loop: LoopState, now: number): void {
  loop.frameId = undefined

  if (loop.isHeld) {
    drawHeld(loop, now)
    return
  }

  const motion = advance(loop, now)
  const isMoving = motion === 'seen'
  const isDrawDue = loop.isAnimating && now - loop.lastDrawAt >= SMALL_MOTION_GAP_MS

  if (isMoving || loop.isDirty || isDrawDue) {
    loop.isAnimating = loop.deps.draw(loop.accMs / SIM_STEP_MS, now)
    loop.lastDrawAt = now
    loop.isDirty = false
  }

  if (isMoving) {
    requestFrame(loop)
  } else if (loop.isAnimating || motion === 'unseen') {
    // Movement off the stage keeps stepping at the sim's rate and never draws for itself.
    const drawWait = loop.isAnimating ? loop.lastDrawAt + SMALL_MOTION_GAP_MS - now : Infinity
    const stepWait = motion === 'unseen' ? SIM_STEP_MS : Infinity

    armTimer(loop, Math.min(drawWait, stepWait), () => requestFrame(loop))
  } else {
    rest(loop)
  }
}

// A held loop draws the last snapshot once when asked, never steps and arms no timer.
function drawHeld(loop: LoopState, now: number): void {
  if (loop.isDirty) {
    loop.deps.draw(loop.accMs / SIM_STEP_MS, now)
    loop.lastDrawAt = now
    loop.isDirty = false
  }

  loop.isAnimating = false
}

function advance(loop: LoopState, now: number): StepMotion {
  const last = loop.lastFrameAt
  let motion: StepMotion = 'still'

  loop.lastFrameAt = now
  loop.accMs += last === undefined ? 0 : Math.min(now - last, MAX_FRAME_DT_MS)

  while (loop.accMs >= SIM_STEP_MS) {
    loop.accMs -= SIM_STEP_MS
    motion = mergeMotion(motion, loop.deps.step(loop.index))
    loop.index++
  }

  return motion
}

/** The more visible of two steps' motion. */
export function mergeMotion(a: StepMotion, b: StepMotion): StepMotion {
  if (a === 'seen' || b === 'seen') {
    return 'seen'
  }

  return a === 'unseen' || b === 'unseen' ? 'unseen' : 'still'
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

  // A stage hidden by its pane resumes when it is shown again.
  comeBack(loop)
}

function halt(loop: LoopState): void {
  clearTimer(loop)

  if (loop.frameId !== undefined) {
    cancelAnimationFrame(loop.frameId)
    loop.frameId = undefined
  }

  loop.isIdle = true
}

// One frame outstanding at most: a second request waits for the one already asked for.
function requestFrame(loop: LoopState): void {
  clearTimer(loop)

  if (loop.frameId !== undefined) {
    return
  }

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
