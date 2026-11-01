/** What the reasoning feed remembers between provider calls, so a retried or later turn keeps
 *  the same throttle instead of restarting it. */
export interface ThinkingState {
  tail: string
  lastEmitAt: number
}

export function createThinkingState(): ThinkingState {
  return { tail: '', lastEmitAt: Number.NEGATIVE_INFINITY }
}
