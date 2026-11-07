import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { BriefText } from '@/trading/features/brief/surface'
import type { BriefServices } from '@/trading/features/brief/types'
import type { ScreenRowText } from '@/trading/features/market-data/types'
import type { MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type {
  RefreshAllMarketDataOptions,
  RefreshMarketDataResult,
} from '@/trading/kernel/market/refresh'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { Market } from '@/trading/markets/types'

export interface PublicToggles {
  readonly analysis: boolean
  readonly headlines: boolean
}

/** One market's top names by composite score, read from no book. A line is written once per
 *  language when the list is built, so a stored list renders without the market data feature. */
export interface PublicScreen {
  readonly market: MarketRef
  readonly asOf: TradingDay
  readonly rows: Record<Locale, readonly ScreenRowText[]>
}

/** One day of the brief the daemon posts to the public side, and how many times it tried. A day
 *  whose build came back empty has no `sections`: the attempt is on record all the same. */
export interface PublicBriefRow {
  readonly day: TradingDay
  readonly sections?: readonly BriefSectionResult[]
  readonly screens?: readonly PublicScreen[]
  readonly builtAt?: number
  readonly publishedAt?: number
  readonly attempts: number
  readonly lastAttemptAt?: number
}

/** A row with a build behind it: what the renderer and the story step read. */
export type BuiltPublicBriefRow = PublicBriefRow & {
  readonly sections: readonly BriefSectionResult[]
  readonly builtAt: number
}

interface PublicBriefAttempt {
  readonly day: TradingDay
  readonly at: number
  readonly publishedAt?: number
  /** No attempt remains for the day: a post the public side refused for good. */
  readonly closed?: true
}

/** Everything the public brief keeps, in its own table: nothing here is read from or written to
 *  the owner's brief. A row that cannot be read reads as unbuilt. */
export interface PublicBriefStore {
  find(day: TradingDay, signal: AbortSignal): Promise<PublicBriefRow | null>
  /** The newest earlier row that has sections. */
  findPrevious(before: TradingDay, signal: AbortSignal): Promise<BuiltPublicBriefRow | null>
  /** Keeps the row's attempts and publish stamp, and drops the days past the retention window. */
  saveBuilt(
    built: Pick<BuiltPublicBriefRow, 'day' | 'sections' | 'screens' | 'builtAt'>,
    signal: AbortSignal
  ): Promise<BuiltPublicBriefRow>
  /** Counts the attempt, and creates the row when there is none, so an empty build counts. */
  recordAttempt(attempt: PublicBriefAttempt, signal: AbortSignal): Promise<void>
}

export interface PublicBriefInput {
  readonly day: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

export interface PublicBriefDeps {
  /** The market that composes the brief and owns the calendar it is dated on. */
  readonly market: Market
  /** The markets this build refreshes, reads and screens. */
  readonly markets: readonly MarketRef[]
  /** The reads its sections take: none of them is the operator's. */
  readonly reads: BriefServices
  readonly store: PublicBriefStore
  readonly toggles: PublicToggles
  /** The most rows a section or the story carries. */
  readonly limit: number
  /** Names per market in the screen lists; 0 reads no screen. */
  readonly topScreen: number
  readonly logger: Logger
  refresh(options: RefreshAllMarketDataOptions): Promise<readonly RefreshMarketDataResult[]>
  /** The market's top names, ranked by score and written in both languages. Undefined where the
   *  market has no screen or ranked no name. */
  screen(request: {
    readonly market: MarketRef
    readonly limit: number
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<Omit<PublicScreen, 'market'> | undefined>
}

/** One screen list as the reader prints it: the title and the closing note are the daemon's own
 *  wording, and a name is a line of text. */
export interface PublicScreenText {
  readonly market: MarketRef
  readonly title: string
  readonly asOf: TradingDay
  readonly rows: readonly ScreenRowText[]
  readonly note: string
}

export interface PublicBriefRender {
  readonly day: TradingDay
  readonly builtAt: number
  readonly texts: Record<Locale, BriefText>
  readonly screens: Record<Locale, readonly PublicScreenText[]>
  readonly headline: Record<Locale, string>
}

/** What the daemon posts with. Held in the composition's closure and handed to the publisher: it is
 *  in no config, log or error. */
export interface PublicBriefCredential {
  readonly token: string
}

/** What the public side answered. A refusal carries its status only; nothing else of the answer is
 *  kept. */
export type PublishOutcome =
  | {
      readonly kind: 'stored' | 'unchanged'
      readonly subscribers: number
      readonly rejected: number
    }
  | { readonly kind: 'refused'; readonly status: number }
  | { readonly kind: 'unreachable' }

/** Posts one rendered day to the public side. Aborting the signal ends the post. */
export interface PublicBriefPublisher {
  publish(render: PublicBriefRender, signal: AbortSignal): Promise<PublishOutcome>
}
