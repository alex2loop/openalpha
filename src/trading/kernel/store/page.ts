export interface Page<T, TCursor> {
  readonly items: readonly T[]
  readonly nextCursor?: TCursor
}

export interface PageOptions<TCursor> {
  readonly cursor?: TCursor
  readonly limit: number
  readonly signal: AbortSignal
}

/** One bounded daemon-tick batch over a cursor. Lives beside `PageOptions` because it is the same
 *  batching vocabulary — a tick is a paged read that also acts on what it reads. */
export interface OperationTickOptions<TCursor = never> {
  readonly now: number
  readonly batchSize: number
  readonly cursor?: TCursor
  readonly signal: AbortSignal
}
