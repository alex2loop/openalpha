import type { Locale } from '@/core/types/locale'
import type { SkippedFill, SkipReason, VenueSyncResult } from '@/trading/features/ledger/sync'
import type { LedgerEntry } from '@/trading/features/ledger/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { CurrencyCode, VenueRef } from '@/trading/kernel/instrument'
import type { Book } from '@/trading/kernel/operator/book'
import type { Venue } from '@/trading/venues/types'
import { BRAND } from '@/core/brand'
import { formatDay, pluralKey, t } from '@/i18n'
import { fxRateApplies } from '@/trading/features/ledger/fx-rate'
import { renderEntry } from '@/trading/features/ledger/rows'
import { quoteConventionsFor } from '@/trading/features/market-data/command/quote-conventions'
import { MAXIMUM_NAMES_PER_LIST } from '@/trading/markets/overview-rollups'
import { formatCount, renderVenueName, SECTION_ICONS } from '@/trading/render/format'
import {
  INDENT,
  INLINE_SEPARATOR,
  joinSections,
  renderEmptyLine,
  renderSectionTitle,
} from '@/trading/render/layout'

interface SyncRenderOptions {
  /** The rows the sync wrote, in the order it wrote them. */
  readonly entries: readonly LedgerEntry[]
  /** Every fill that did not become a row, whether it could not be drafted or the book refused it,
   *  each carrying what stopped it. */
  readonly skipped: readonly SkippedFill[]
  readonly marketData: Pick<MarketDataService, 'quoteConvention'>
  /** The book after the last write; absent when the pass wrote nothing. */
  readonly book?: Book | undefined
}

/** What a venue's fills added to the book, in the same unlabelled row the history prints: a list
 *  read down a page cannot carry a field name at every figure. */
export function renderSyncResult(
  locale: Locale,
  result: VenueSyncResult,
  options: SyncRenderOptions
): string {
  const venue = renderVenueName(locale, result.venue)
  const { entries } = options
  const conventions = quoteConventionsFor(
    options.marketData,
    entries.flatMap((entry) =>
      'instrument' in entry.transaction ? [entry.transaction.instrument] : []
    )
  )

  return joinSections([
    entries.length === 0
      ? [
          renderEmptyLine(
            SECTION_ICONS.ledger,
            t(locale, 'trading.render.ledger.syncNothing', {
              venue,
              day: formatDay(locale, result.fromDay),
            })
          ),
        ]
      : [
          renderSectionTitle(
            SECTION_ICONS.ledger,
            t(
              locale,
              pluralKey(
                entries.length,
                'trading.render.ledger.syncRecordedOne',
                'trading.render.ledger.syncRecorded'
              ),
              { venue, count: formatCount(locale, entries.length) }
            )
          ),
          ...entries.map((entry) => `${INDENT[1]}${renderEntry(locale, entry, conventions)}`),
        ],
    renderMarketFxLines(locale, entries, options.book),
    alreadyBookedLine(locale, result.alreadyBooked),
    coverageLine(locale, result, venue),
    options.skipped.length === 0 ? [] : skippedLines(locale, options.skipped),
  ])
}

/** Fills convert at each day's market rate; one line per currency names that, and how to restate a
 *  row the operator funded over P2P. */
function renderMarketFxLines(
  locale: Locale,
  entries: readonly LedgerEntry[],
  book: Book | undefined
): readonly string[] {
  const counts = new Map<CurrencyCode, number>()

  for (const { transaction } of entries) {
    if ('conversion' in transaction && transaction.conversion.source === 'provider') {
      const { fromCurrency, toCurrency } = transaction.conversion

      const ratePriced = book === undefined || fxRateApplies(book, transaction)

      if (fromCurrency !== toCurrency && ratePriced) {
        counts.set(fromCurrency, (counts.get(fromCurrency) ?? 0) + 1)
      }
    }
  }

  return [...counts].map(([currency, count]) =>
    t(
      locale,
      pluralKey(
        count,
        'trading.render.ledger.syncMarketFxOne',
        'trading.render.ledger.syncMarketFx'
      ),
      { count: formatCount(locale, count), currency }
    )
  )
}

/** On every run, not only an empty one: a venue that lists fills by symbol can miss a round trip on
 *  a coin nobody named, and a run that booked twelve rows would otherwise read as complete. */
function coverageLine(locale: Locale, result: VenueSyncResult, venue: string): readonly string[] {
  if (result.coverage !== 'by-symbol') {
    return []
  }

  return [`${INDENT[1]}${t(locale, 'trading.render.ledger.syncCoverageBySymbol', { venue })}`]
}

/** Fills the book already held. Nothing was written, but a run that recognised twelve of them must
 *  not read like a venue that reported nothing. */
function alreadyBookedLine(locale: Locale, alreadyBooked: number): readonly string[] {
  if (alreadyBooked === 0) {
    return []
  }

  return [
    `${INDENT[1]}${t(
      locale,
      pluralKey(
        alreadyBooked,
        'trading.render.ledger.syncAlreadyBookedOne',
        'trading.render.ledger.syncAlreadyBooked'
      ),
      { count: formatCount(locale, alreadyBooked) }
    )}`,
  ]
}

/** One line per reason rather than one per fill: a venue that lists fifty unlisted pairs should
 *  report one fact, not fifty. Names are bounded for the same reason every list here is. */
function skippedLines(locale: Locale, skipped: readonly SkippedFill[]): readonly string[] {
  const byReason = new Map<SkipReason, string[]>()

  for (const fill of skipped) {
    const names = byReason.get(fill.reason) ?? []

    names.push(fill.symbol)
    byReason.set(fill.reason, names)
  }

  return [
    `${INDENT[1]}${t(
      locale,
      pluralKey(
        skipped.length,
        'trading.render.ledger.syncSkippedTitleOne',
        'trading.render.ledger.syncSkippedTitle'
      ),
      { count: formatCount(locale, skipped.length) }
    )}`,
    ...[...byReason].map(
      ([reason, names]) =>
        `${INDENT[2]}${t(locale, 'trading.render.ledger.syncSkippedRow', {
          count: formatCount(locale, names.length),
          reason: t(locale, `trading.render.ledger.syncSkipReason.${reason}`),
          symbols: names.slice(0, MAXIMUM_NAMES_PER_LIST).join(INLINE_SEPARATOR),
        })}`
    ),
  ]
}

interface SyncUnavailableInput {
  readonly venue: VenueRef
  readonly found: Venue | null
  readonly known: readonly VenueRef[]
}

/** Why `/record sync` reads nothing from a venue: none by that name, one waiting for its key, or
 *  one traded by hand. */
export function renderSyncUnavailable(locale: Locale, input: SyncUnavailableInput): string {
  const { found } = input

  if (found === null) {
    return t(locale, 'trading.render.ledger.syncUnknownVenue', {
      venue: input.venue,
      venues: input.known.join(', '),
    })
  }

  const venue = renderVenueName(locale, found.manifest.id)
  const missing = found.manifest.missingCredentials

  return missing === undefined
    ? t(locale, 'trading.render.ledger.syncByHand', { venue })
    : t(locale, 'trading.render.ledger.syncKeyless', {
        venue,
        variables: missing.join(', '),
        brand: BRAND.name,
      })
}
