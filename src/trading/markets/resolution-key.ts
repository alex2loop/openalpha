import type { MarketRef } from '@/trading/kernel/instrument'
import type { ResolveMarketOptions } from '@/trading/markets/types'

interface ResolutionScope {
  readonly preferred: MarketRef | undefined
  readonly skipped: readonly MarketRef[]
}

// Every field that changes the answer is part of the key, so the cache never serves a wider one.
export function buildResolutionKey(options: ResolveMarketOptions, scope: ResolutionScope): string {
  const parts = [
    options.within === undefined ? '' : `in:${[...options.within].sort().join(',')}`,
    options.detection ?? '',
    options.operatorRead === true ? 'read' : '',
    scope.preferred === undefined ? '' : `held:${scope.preferred}`,
    scope.skipped.length === 0 ? '' : `off:${scope.skipped.join(',')}`,
  ]
  const name = options.market === undefined ? options.ticker : `${options.market}/${options.ticker}`

  return parts.every((part) => part === '') ? name : `${parts.join('|')}|${name}`
}
