/** One model of a tier. Prices are USD per million tokens; `source` says where they came from
 *  (`fallback` is a conservative stand-in for a model no feed lists: the cost caps count it at that
 *  price, so it is the highest tier, never zero). `perRunUsd` is the mean cost
 *  of one run on this model over its recent runs; absent until it has run. */
export interface ModelEntryWire {
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

/** GET /v1/models/prices?provider=&models= — `models` is a JSON list of at most 50 model names of
 *  one provider, each as the config would name it. Answers each in the order asked, as `/v1/models`
 *  does a configured one; a model nothing prices answers `source: 'fallback'`. */
export interface ModelPricesResponse {
  readonly models: readonly ModelEntryWire[]
}
