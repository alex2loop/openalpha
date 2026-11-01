/** One model of a tier. Prices are USD per million tokens; `source` says where they came from
 *  (`fallback` is a conservative stand-in for a model no feed lists). `perRunUsd` is the mean cost
 *  of one run on this model over its recent runs; absent until it has run. */
interface ModelEntryWire {
  readonly provider: string
  readonly model: string
  readonly supportsTools: boolean
  readonly price: {
    readonly inPerM: number
    readonly outPerM: number
    readonly cacheReadPerM?: number
    readonly cacheWritePerM?: number
    readonly source: string
  }
  readonly perRunUsd?: number
}

/** GET /v1/models — the tiers the daemon resolved, each in the order its models are tried. Under
 *  `mcp serve` (`modelSource: 'client'`) the connected client's model answers every call, so there
 *  are no tiers to list. */
export interface ModelsResponse {
  readonly modelSource: 'config' | 'client'
  readonly tiers: readonly {
    readonly tier: string
    readonly models: readonly ModelEntryWire[]
  }[]
}
