import type { Locale } from '@/core/types/locale'
import type { SkippedFill, SkipReason, VenueSyncResult } from '@/trading/features/ledger/sync'
import type { LedgerEntry } from '@/trading/features/ledger/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import { formatDay, pluralKey, t } from '@/i18n'
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
    alreadyBookedLine(locale, result.alreadyBooked),
    coverageLine(locale, result, venue),
    options.skipped.length === 0 ? [] : skippedLines(locale, options.skipped),
  ])
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
