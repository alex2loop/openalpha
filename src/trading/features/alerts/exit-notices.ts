import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { PortfolioAtOptions } from '@/trading/features/portfolio/options'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { StopCover } from '@/trading/kernel/operator/alert'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { OperationTickOptions } from '@/trading/kernel/store/page'
import type { Market } from '@/trading/markets/types'
import type { QuotedIn } from '@/trading/render/money'
import type { StopPlacement } from '@/trading/render/stop-raised'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { renderLevelLines } from '@/trading/features/suggestion/render/hold-levels'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { sendCaught } from '@/trading/kernel/operator/delivery-retry'
import { INDENT } from '@/trading/render/layout'
import { renderBoardScaleNotes } from '@/trading/render/money'
import { renderStopRaised } from '@/trading/render/stop-raised'

/** A stop the operator set in the exchange's app is moved there by hand, never by `/trade exit`,
 *  which would place a second one beside it. */
const PLACEMENT_BY_COVER: Readonly<Record<StopCover, StopPlacement>> = Object.freeze({
  placed: 'resting',
  venue: 'by-hand',
  none: 'unguarded',
})

/** What the exit-plan notices read; the plan-maintenance passes hold more. */
export interface ExitNoticeDeps {
  readonly sender: TradingNoticeSender
  readonly logger: Logger
  readonly defaultLocale: Locale
  /** Whether a stop rests at the exchange behind each held name, keyed by `buildInstrumentKey`.
   *  Absent on an install with no exchange, where nothing could rest anywhere. */
  restingStops?(options: PortfolioAtOptions): Promise<ReadonlyMap<string, StopCover>>
}

interface NoticeTarget {
  readonly instrument: InstrumentRef
  readonly delivery: DeliveryAddress
  readonly options: OperationTickOptions
}

interface PlannedNotice extends NoticeTarget {
  readonly market: Market | null
  readonly plan: StoredSuggestion
}

interface StopRaisedNotice extends NoticeTarget {
  readonly market: Market
  readonly from: number
  readonly to: number
}

/** Best-effort: the plan is already stored and arms whether or not the send lands. */
export async function noticePlanned(deps: ExitNoticeDeps, input: PlannedNotice): Promise<void> {
  const { instrument, delivery, options, market } = input
  const { quoted, notes } = priceConventionOf(deps.defaultLocale, market)
  const boardLot = market?.manifest.boardLot
  const outcome = await sendCaught(
    deps.sender,
    {
      target: delivery,
      locale: deps.defaultLocale,
      payload: {
        kind: 'exit-plan',
        lines: [
          ...renderLevelLines({
            locale: deps.defaultLocale,
            suggestion: input.plan,
            quoted,
            trailsStop: market?.trail !== undefined,
            operatorFigures: 'shown',
            ...(boardLot === undefined ? {} : { boardLot }),
          }),
          ...notes,
        ],
      },
    },
    options.signal
  )

  if (outcome !== 'accepted') {
    deps.logger.warn('trading.exit_plan_notice_undelivered', { ticker: instrument.ticker, outcome })
  }
}

/** Best-effort, like the plan notice: the raised stop is already stored and armed. */
export async function noticeStopRaised(
  deps: ExitNoticeDeps,
  input: StopRaisedNotice
): Promise<void> {
  const { instrument, market, options } = input
  const { quoted, notes } = priceConventionOf(deps.defaultLocale, market)
  const lines = [
    ...renderStopRaised(deps.defaultLocale, {
      instrument,
      from: input.from,
      to: input.to,
      quoted,
      placement: await placementOf(deps, input),
    }),
    ...notes,
  ]
  const outcome = await sendCaught(
    deps.sender,
    {
      target: input.delivery,
      locale: deps.defaultLocale,
      payload: { kind: 'stop-raised', lines },
    },
    options.signal
  )

  if (outcome !== 'accepted') {
    deps.logger.warn('trading.stop_raised_notice_undelivered', {
      ticker: instrument.ticker,
      outcome,
    })
  }
}

/** A name no venue this tree places on holds is carried by hand. A book that could not be read is
 *  `unread`, which still names the command: the exchange may hold a stop nobody can see. */
async function placementOf(deps: ExitNoticeDeps, input: NoticeTarget): Promise<StopPlacement> {
  const { instrument, options } = input

  if (deps.restingStops === undefined) {
    return 'by-hand'
  }

  try {
    const stops = await deps.restingStops({ now: options.now, signal: options.signal })
    const resting = stops.get(buildInstrumentKey(instrument))

    if (resting === undefined) {
      return 'by-hand'
    }

    return PLACEMENT_BY_COVER[resting]
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.resting_stops_unread', {
      ticker: instrument.ticker,
      err: formatErrForLog(err),
    })

    return 'unread'
  }
}

/** How a market prints a price, and the board-scale note lines beneath; bare when unlisted. */
function priceConventionOf(
  locale: Locale,
  market: Market | null
): { readonly quoted: Partial<QuotedIn>; readonly notes: readonly string[] } {
  if (market === null) {
    return { quoted: {}, notes: [] }
  }

  const { manifest } = market
  const quoted: QuotedIn = {
    currency: manifest.currency,
    unit: manifest.quoteUnit,
    ...(manifest.priceDisplay === undefined ? {} : { display: manifest.priceDisplay }),
  }
  const notes = renderBoardScaleNotes(locale, [{ market: manifest.id, ...quoted }]).map(
    (note) => `${INDENT[1]}${note}`
  )

  return { quoted, notes }
}
