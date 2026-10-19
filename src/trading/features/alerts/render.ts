import type { Locale } from '@/core/types/locale'
import type { Alert, DeliveringAlert } from '@/trading/features/alerts/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { AlertId } from '@/trading/kernel/operator/alert'
import type { TradingNoticePayload } from '@/trading/kernel/operator/notice'
import type { Page } from '@/trading/kernel/store/page'
import type { QuoteConvention, QuotedIn } from '@/trading/render/money'
import { pluralKey, t } from '@/i18n'
import { parseExitLevel } from '@/trading/features/alerts/types'
import { buildInstrumentKey, toIdHandle } from '@/trading/kernel/instrument'
import {
  formatCount,
  formatFraction,
  formatSignedFixedPercent,
  renderDeclaredValue,
  SECTION_ICONS,
} from '@/trading/render/format'
import {
  INDENT,
  INLINE_SEPARATOR,
  joinSections,
  renderEmptyLine,
  renderSectionTitle,
} from '@/trading/render/layout'
import { renderMarketBlocks, toMarketBlocks } from '@/trading/render/market-blocks'
import { formatPriceIn, quotedInOf, renderBoardScaleNotes } from '@/trading/render/money'

/** The quantity `/record sell` reads as the whole position. Alerts may not import the ledger, which
 *  owns the token. */
const SELL_WHOLE_POSITION = 'all'
const EXIT_REACHED_KEYS = {
  stop: 'trading.exit.stopReached',
  target: 'trading.exit.targetReached',
} as const

type AlertNotice = Extract<TradingNoticePayload, { readonly alert: DeliveringAlert }>
type ScreenerNotice = Extract<AlertNotice, { readonly kind: 'screener-alert' }>

/** What each instrument last traded at and how it prints, keyed by instrument. A name missing from
 *  either renders without its distance, or as a bare number, rather than failing. */
interface AlertRenderOptions {
  readonly priceByInstrument?: ReadonlyMap<string, number>
  readonly quoteConventions?: ReadonlyMap<string, QuoteConvention>
}

/** Every row carries its id because `/alert disable` names an alert by id and nothing else prints
 *  one, and its state because the page spans fired and disabled rows as well as armed ones. */
export function renderAlertListText(
  locale: Locale,
  page: Page<Alert, AlertId>,
  options: AlertRenderOptions = {}
): string {
  if (page.items.length === 0) {
    return renderEmptyLine(SECTION_ICONS.alert, t(locale, 'trading.render.alert.empty'))
  }

  const blocks = toMarketBlocks(page.items, (alert) => alert.instrument.market)
  const [first] = blocks
  const onlyMarket = blocks.length > 1 ? undefined : first?.market

  return joinSections([
    [
      renderSectionTitle(SECTION_ICONS.alert, renderTitle(locale, page.items.length, onlyMarket)),
      ...renderMarketBlocks(locale, blocks, {
        icon: SECTION_ICONS.alert,
        renderRows: (alerts) =>
          alerts.map((alert) => `${INDENT[1]}${renderRow(locale, alert, options)}`),
      }),
      ...boardScaleLines(locale, page.items, options),
      // The page carries no total, so the line says more follow without claiming how many.
      ...(page.nextCursor === undefined
        ? []
        : [`${INDENT[1]}${t(locale, 'trading.render.alert.more')}`]),
    ],
  ])
}

/** A list on one market has no rule to name it, so the title does. */
function renderTitle(locale: Locale, count: number, market: MarketRef | undefined): string {
  const shared = { count: formatCount(locale, count) }

  if (market === undefined) {
    return t(
      locale,
      pluralKey(count, 'trading.render.alert.titleOne', 'trading.render.alert.title'),
      shared
    )
  }

  return t(
    locale,
    pluralKey(count, 'trading.render.alert.titleMarketOne', 'trading.render.alert.titleMarket'),
    {
      ...shared,
      market: renderDeclaredValue(locale, `trading.market.${market}`),
    }
  )
}

function renderRow(locale: Locale, alert: Alert, options: AlertRenderOptions): string {
  return `${t(locale, 'trading.render.alert.row', {
    state: renderDeclaredValue(locale, `trading.alert.state.${alert.state}`),
    ticker: alert.instrument.ticker,
    condition: renderDeclaredValue(locale, `trading.alert.condition.${alert.condition}`),
    threshold: formatPriceIn(locale, alert.threshold, quoteOf(options, alert)),
    id: toIdHandle(alert.id),
  })}${renderDistance(locale, alert, options)}`
}

/** Leads with the action: the headline, then for an exit alert what it means and how to record the
 *  sale, then where to look again. The short id closes every notice: a crash between `accepted` and
 *  `markFired` may re-deliver, and a duplicate the reader can recognise beats a lost alert. A fired
 *  alert is already spent, so there is no "turn off" line. A screener notice is detection, not a
 *  suggestion, so it points at an on-demand `/suggest`. */
export function renderAlertNotice(locale: Locale, notice: AlertNotice): string {
  const { alert } = notice
  const headline = [t(locale, `trading.notice.${notice.kind}`), priceLine(locale, notice)]

  return [
    headline.join(INLINE_SEPARATOR),
    ...(notice.kind === 'exit-alert' ? exitLines(locale, alert) : []),
    ...(notice.kind === 'screener-alert'
      ? [
          ...sessionLines(locale, notice),
          t(locale, 'trading.screener.hint', { ticker: alert.instrument.ticker }),
        ]
      : [
          t(locale, 'trading.alert.reviewHint', {
            instrument: buildInstrumentKey(alert.instrument),
          }),
        ]),
    toIdHandle(alert.id),
  ].join('\n')
}

/** What the level means, then the line that books the sale. The fill can sit below the price that
 *  was observed and a board-scaled price is not what `/record` reads, so the price stays a
 *  placeholder; the quantity is the whole position at a stop and unknown at a target, because the
 *  tranche size is not in the payload. */
function exitLines(locale: Locale, alert: DeliveringAlert): readonly string[] {
  const level = parseExitLevel(alert.origin)

  if (level === null) {
    return []
  }

  const quantity =
    level === 'stop' ? SELL_WHOLE_POSITION : t(locale, 'trading.exit.recordHintQuantity')

  return [
    t(locale, EXIT_REACHED_KEYS[level]),
    t(locale, 'trading.exit.recordHint', {
      instrument: buildInstrumentKey(alert.instrument),
      quantity,
    }),
  ]
}

function priceLine(locale: Locale, notice: AlertNotice): string {
  const { alert, quote } = notice
  const level = notice.kind === 'exit-alert' ? parseExitLevel(alert.origin) : null
  const label = level === null ? '' : `${t(locale, `trading.exit.level.${level}`)} `
  const condition = renderDeclaredValue(locale, `trading.alert.condition.${alert.condition}`)
  const threshold = formatPriceIn(locale, alert.threshold, quote)
  const observed = formatPriceIn(locale, alert.observedPrice, quote)

  return `${alert.instrument.ticker} ${label}${condition} ${threshold} (${observed})`
}

/** The benchmark's move beside the name's, with no verdict: how much of a move is the market
 *  depends on the stock, and no cut-off has been measured. */
function sessionLines(locale: Locale, notice: ScreenerNotice): readonly string[] {
  const { alert, session } = notice

  if (session === undefined) {
    return []
  }

  const ticker = alert.instrument.ticker
  const move = formatSignedFixedPercent(locale, session.movePct)

  if (session.benchmark === undefined) {
    return [t(locale, 'trading.screener.move', { ticker, move })]
  }

  return [
    t(locale, 'trading.screener.moveWithBenchmark', {
      ticker,
      move,
      benchmark: session.benchmark.ticker,
      benchmarkMove: formatSignedFixedPercent(locale, session.benchmark.movePct),
    }),
  ]
}

/** How far the price still has to travel, on an armed row only: a fired or disabled alert is not
 *  waiting for anything, and a distance beside it would read as one that could still fire. */
function renderDistance(locale: Locale, alert: Alert, options: AlertRenderOptions): string {
  const last = options.priceByInstrument?.get(buildInstrumentKey(alert.instrument))

  if (alert.state !== 'active' || last === undefined || last <= 0) {
    return ''
  }

  return ` · ${t(locale, 'trading.render.alert.distance', {
    price: formatPriceIn(locale, last, quoteOf(options, alert)),
    distance: formatFraction(locale, Math.abs(alert.threshold - last) / last),
  })}`
}

/** How this alert's instrument prints a price, currency included: an alert row names no holding, so
 *  the market's own quote currency is the only one it could be in. Absent for a level or a name the
 *  registry cannot resolve, and the row then prints a bare number rather than a guess. */
function quoteOf(options: AlertRenderOptions, alert: Alert): QuotedIn | undefined {
  const convention = options.quoteConventions?.get(buildInstrumentKey(alert.instrument))

  return convention === undefined
    ? undefined
    : { currency: convention.currency, ...quotedInOf(convention) }
}

/** A list mixing a board-scaled market with a plain one has no way to say which rows are in points,
 *  so it says it once underneath - the same note `/portfolio` and the quoteBoard board print. */
function boardScaleLines(
  locale: Locale,
  alerts: readonly Alert[],
  options: AlertRenderOptions
): readonly string[] {
  const quotes = alerts.flatMap((alert) => {
    const convention = options.quoteConventions?.get(buildInstrumentKey(alert.instrument))

    return convention?.display === undefined
      ? []
      : [
          {
            market: alert.instrument.market,
            currency: convention.currency,
            display: convention.display,
          },
        ]
  })

  return renderBoardScaleNotes(locale, quotes).map((note) => `${INDENT[1]}${note}`)
}
