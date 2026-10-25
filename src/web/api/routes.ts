import type { LiveSnapshotWire } from '@/app/server/wire/live'
import type { HealthResponse, StatePayload } from '@/app/server/wire/system'

/** A `/v1` path tagged with the wire shape it answers, so `getJson` returns that shape. */
export interface RouteDef<T> {
  readonly path: string
  // Never set: it carries `T` so a call infers the response type from the route.
  readonly response?: T
}

export const ROUTES = Object.freeze({
  health: route<HealthResponse>('/v1/health'),
  state: route<StatePayload>('/v1/state'),
  live: route<LiveSnapshotWire>('/v1/live'),
})

function route<T>(path: string): RouteDef<T> {
  return { path }
}
