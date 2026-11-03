import type { SourceId } from '@/trading/kernel/source/source-id'

/** The request one adapter built for a route cell, recorded instead of sent. */
export interface Captured {
  readonly id: SourceId
  readonly cell: string
  readonly url: string
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
}

/** What a browser page would see answering a `Captured` request. */
export interface Measurement {
  readonly captured: Captured
  readonly status: string
  readonly allowOrigin: string
  readonly preflight: string
  readonly cors: boolean
  readonly preview: string
}

/** Everything the recording pass found: the requests, the cells that sent none, the providers that
 *  need a key the environment does not hold. */
export interface Capture {
  readonly captured: readonly Captured[]
  readonly unprobed: readonly string[]
  readonly needsKey: readonly SourceId[]
}
