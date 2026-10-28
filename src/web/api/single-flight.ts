interface Flight {
  readonly task: (signal: AbortSignal) => Promise<void>
  readonly signal: AbortSignal
  running: Promise<void> | undefined
  isRerunWanted: boolean
}

/** Wraps a load so at most one runs at a time: a call while one runs asks for one more run after it,
 *  however many calls came in, and gets the running one's promise. `task` records its own failure,
 *  so the returned promise never rejects. */
export function createSingleFlight(
  task: (signal: AbortSignal) => Promise<void>,
  signal: AbortSignal
): () => Promise<void> {
  const flight: Flight = { task, signal, running: undefined, isRerunWanted: false }

  return () => {
    if (flight.running !== undefined) {
      flight.isRerunWanted = true
      return flight.running
    }

    flight.running = runFlight(flight)

    return flight.running
  }
}

// The flag is read and `running` cleared in one synchronous step, so no call can fall between them.
async function runFlight(flight: Flight): Promise<void> {
  try {
    do {
      flight.isRerunWanted = false
      // A task records its own failure; an unexpected throw must not end the reruns.
      await flight.task(flight.signal).catch(() => undefined)
    } while (flight.isRerunWanted && !flight.signal.aborted)
  } finally {
    flight.running = undefined
  }
}
