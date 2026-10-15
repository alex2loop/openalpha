import type { Logger } from '@/core/logging/logger'
import type { NewsArchiveStore } from '@/trading/features/market-data/store/news-archive'
import type { NewsItem } from '@/trading/kernel/market/market-data'
import type { SourceKind, SourceKindMap, SourceResult } from '@/trading/kernel/source/source-result'
import type { ResolveSourceOptions, SourceRegistry } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'

interface NewsArchiveDeps {
  readonly archive: Pick<NewsArchiveStore, 'archive'>
  readonly logger: Logger
}

/** A failed write is logged and never fails the read it rides on; a cancel still propagates. */
async function archiveIfNews<K extends SourceKind>(
  deps: NewsArchiveDeps,
  options: ResolveSourceOptions<K>,
  result: SourceResult<SourceKindMap[K]>
): Promise<void> {
  if (options.kind !== 'news' || result.kind !== 'available') {
    return
  }

  // why-safe: `kind === 'news'` fixes K, and SourceKindMap['news'] is readonly NewsItem[].
  const items = result.value as readonly NewsItem[]
  const { market, instrument } = options.context

  try {
    await deps.archive.archive({
      items,
      ...(market === undefined ? {} : { market }),
      ...(instrument === undefined ? {} : { ticker: instrument.ticker }),
      now: Date.now(),
      signal: options.signal,
    })
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.news_archive_failed', { err: formatErrForLog(err) })
  }
}

/** Every headline in every market passes through the registry, so archiving here needs no caller
 *  to remember it. */
export function withNewsArchive(registry: SourceRegistry, deps: NewsArchiveDeps): SourceRegistry {
  return Object.freeze({
    ...registry,
    async resolve<K extends SourceKind>(
      options: ResolveSourceOptions<K>
    ): Promise<SourceResult<SourceKindMap[K]>> {
      const result = await registry.resolve(options)

      await archiveIfNews(deps, options, result)

      return result
    },
    async resolveAll<K extends SourceKind>(
      options: ResolveSourceOptions<K>
    ): Promise<readonly SourceResult<SourceKindMap[K]>[]> {
      const results = await registry.resolveAll(options)

      for (const result of results) {
        await archiveIfNews(deps, options, result)
      }

      return results
    },
  })
}
