import type { Logger } from '@/core/logging/logger'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { EvidenceDraft, EvidenceKind } from '@/trading/features/themes/types'
import type { MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { SourceRegistry } from '@/trading/markets/types'

interface SeriesRead {
  readonly seriesId: string
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
  readonly signal: AbortSignal
}

interface NewsRead {
  readonly fromMs: number
  readonly toMs: number
  readonly signal: AbortSignal
}

export interface NewsHeadline {
  readonly url: string
  readonly title: string
  readonly summary?: string
  readonly publishedAt: number
  readonly market?: MarketRef
}

/** Reads the stores this feature may not import, bound by wiring. */
export interface EvidenceDeps {
  readonly sources: Pick<SourceRegistry, 'resolve'>
  readonly marketData: Pick<MarketDataService, 'sectors'>
  readSeries(options: SeriesRead): Promise<readonly { day: TradingDay; value: number }[]>
  listNews(options: NewsRead): Promise<readonly NewsHeadline[]>
  readonly logger: Logger
}

export interface EvidenceRequest {
  readonly now: number
  /** News published from here on; the run before this one already read what came earlier. */
  readonly newsSince: number
  readonly signal: AbortSignal
}

export interface EvidencePart {
  readonly kind: EvidenceKind
  readonly drafts: readonly EvidenceDraft[]
  readonly missing: boolean
  /** Read in part: more items came in than one run reads, so only the newest went in. */
  readonly capped?: true
}
