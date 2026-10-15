import type { App } from '@/core/container'
import type { OperationPolicy } from '@/trading/kernel/config'
import type { SourceRegistry } from '@/trading/markets/types'
import { createMacroExtractTick } from '@/trading/features/market-data/macro-extract/tick'
import { EXTRACTION_MODEL_TIER } from '@/trading/kernel/config'

export function buildMacroExtractTick(
  app: App,
  sources: SourceRegistry
): (policy: OperationPolicy) => (signal: AbortSignal) => Promise<void> {
  const chains = app.resolve('llmChains')
  const stores = app.resolve('tradingStores')

  return (policy) =>
    createMacroExtractTick({
      sources,
      store: stores.macroExtract,
      news: stores.newsArchive,
      chain: chains.findTier(EXTRACTION_MODEL_TIER) ?? chains.primary,
      recordAttempt: app.resolve('attemptRecorder'),
      batchSize: policy.batchSize,
      logger: app.resolve('logger'),
    })
}
