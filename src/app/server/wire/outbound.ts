export type OutboundPurpose =
  | 'data'
  | 'news'
  | 'model'
  | 'pricing'
  | 'channel'
  | 'exchange'
  | 'plugin'
  | 'mcp'
  | 'search'
  | 'web'
  | 'update'
  | 'social'
  | 'reachability'

/** One place the daemon can send something under this config, and what it sends there in the
 *  daemon's language. `web` has an empty `host`: it goes wherever you or an agent point it. */
export interface OutboundHostWire {
  readonly host: string
  readonly purpose: OutboundPurpose
  readonly sends: string
}

/** GET /v1/outbound — every host this config can call, derived from the code that owns each one. */
export interface OutboundResponse {
  readonly hosts: readonly OutboundHostWire[]
}
