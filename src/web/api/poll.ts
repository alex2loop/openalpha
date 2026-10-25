interface PollState {
  readonly task: (signal: AbortSignal) => Promise<void>
  readonly everyMs: number
  readonly lifetime: AbortController
  timer: ReturnType<typeof setTimeout> | undefined
  running: AbortController | undefined
  lastStartedAt: number
}

/** The page's only poller. Runs `task` at once, then every `everyMs` after each run starts, never two
 *  at a time. A hidden tab skips; on return it runs at once only when the last run is older than
 *  `everyMs`, else it waits out the remainder, so flicking tabs never multiplies the calls. A task
 *  that throws is swallowed: it records its own failure. The returned `stop` is idempotent. */
export function startPoll(
  task: (signal: AbortSignal) => Promise<void>,
  everyMs: number
): () => void {
  const state: PollState = {
    task,
    everyMs,
    lifetime: new AbortController(),
    timer: undefined,
    running: undefined,
    lastStartedAt: Number.NEGATIVE_INFINITY,
  }

  document.addEventListener('visibilitychange', () => resume(state), {
    signal: state.lifetime.signal,
  })
  run(state)

  return () => stop(state)
}

async function run(state: PollState): Promise<void> {
  state.timer = undefined

  if (state.lifetime.signal.aborted || state.running !== undefined || document.hidden) {
    return
  }

  const controller = new AbortController()

  state.running = controller
  state.lastStartedAt = performance.now()

  try {
    await state.task(controller.signal)
  } catch {
    // The task owns its failure line; the poll only keeps going.
  } finally {
    state.running = undefined
  }

  if (!(state.lifetime.signal.aborted || document.hidden)) {
    arm(state)
  }
}

function resume(state: PollState): void {
  clearTimeout(state.timer)
  state.timer = undefined

  // A run in flight arms the next one when it ends.
  if (!document.hidden && state.running === undefined) {
    arm(state)
  }
}

// Waits out what is left of the period since the last run started; none left runs at once.
function arm(state: PollState): void {
  const delayMs = state.everyMs - (performance.now() - state.lastStartedAt)

  clearTimeout(state.timer)
  state.timer = setTimeout(() => run(state), Math.max(0, delayMs))
}

function stop(state: PollState): void {
  state.lifetime.abort()
  clearTimeout(state.timer)
  state.timer = undefined
  state.running?.abort()
}
