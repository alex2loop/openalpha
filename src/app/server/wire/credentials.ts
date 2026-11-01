// The /v1 credentials routes: the key variables the page may set on the server. A value never
// travels back: not whole, not a prefix, not a tail.

/** What a key opens: a model provider, an exchange, web search, or an optional data source. */
export type CredentialGroup = 'provider' | 'venue' | 'search' | 'source'

interface CredentialWire {
  readonly name: string
  readonly group: CredentialGroup
  /** The provider id, venue id, search provider or source id that reads the variable. */
  readonly subject: string
  /** The key file holds a value for it. */
  readonly set: boolean
  /** The daemon's environment holds it from the shell, not from the key file; that value wins. */
  readonly fromShell: boolean
}

/** GET /v1/credentials. `webSearch`: the provider the daemon searches with now, and every one
 *  `[web_search] provider` may name. */
export interface CredentialsResponse {
  readonly credentials: readonly CredentialWire[]
  readonly webSearch: {
    readonly provider: string
    readonly providers: readonly string[]
  }
}

/** POST /v1/credentials/:name body. */
export interface CredentialWriteBody {
  readonly value: string
}

/** POST /v1/credentials/:name: saved in the key file, read by the daemon after a restart. */
export interface CredentialWriteResult {
  readonly name: string
  readonly restartRequired: true
}

/** DELETE /v1/credentials/:name: false when the key file held no value for it. */
export interface CredentialRemoveResult {
  readonly removed: boolean
}
