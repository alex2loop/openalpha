import type { Locale } from '@/core/types/locale'
import type { LedgerStore } from '@/trading/features/ledger/store/ledger'
import type { LedgerEntry } from '@/trading/features/ledger/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { TradingDay, VenueRef } from '@/trading/kernel/instrument'
import type { SpotAdapter } from '@/trading/kernel/venue/spot-adapter'
import type { MarketRegistry } from '@/trading/markets/types'
import type { Venue, VenueRegistry } from '@/trading/venues/types'
import { parseIsoDay } from '@/core/utils/time'
import { t } from '@/i18n'
import { resolveVenueSync } from '@/trading/features/ledger/sync'
import { bookVenueFills } from '@/trading/features/ledger/sync-book'
import { renderSyncResult, renderSyncUnavailable } from '@/trading/features/ledger/sync-render'

type SyncBookDeps = Parameters<typeof bookVenueFills>[0]

/** What `/record sync` and the app's sync both read: the writes, the registries and the store. */
export interface VenueSyncDeps extends SyncBookDeps {
  readonly marketData: Pick<MarketDataService, 'quoteConvention'>
  readonly venues: VenueRegistry
  readonly markets: MarketRegistry
  readonly ledger: Pick<LedgerStore, 'listAll' | 'findByIdempotency'>
}

/** The reply `/record sync` prints, with how many fills it booked and how many it could not. */
export interface VenueSyncOutcome {
  readonly text: string
  readonly recorded: number
  readonly skipped: number
}

/** How far back a sync reaches, which is also the day before which it books nothing. */
interface SyncWindow {
  readonly since: number
  readonly fromDay: TradingDay
  readonly recorded: readonly LedgerEntry[]
}

/** Booked one at a time, oldest first: each write re-folds the whole book, so a buy has to land
 *  before the sale that closes it or the validator refuses a sell the book cannot yet cover. */
export async function runVenueSync(
  deps: VenueSyncDeps,
  input: { readonly venue: VenueRef; readonly locale: Locale; readonly signal: AbortSignal }
): Promise<VenueSyncOutcome> {
  const { venue, locale, signal } = input
  const found = deps.venues.find(venue)

  if (!canSyncFills(found)) {
    const known = deps.venues.list().map((entry) => entry.manifest.id)

    return nothingBooked(renderSyncUnavailable(locale, { venue, found, known }))
  }

  const window = await resolveSyncWindow(deps, signal)

  if (window === undefined) {
    return nothingBooked(t(locale, 'trading.render.ledger.syncNoBook'))
  }

  const result = await resolveVenueSync({
    venue: found,
    adapter: found.adapter,
    markets: deps.markets,
    ledger: deps.ledger,
    recorded: window.recorded,
    since: window.since,
    fromDay: window.fromDay,
    logger: deps.logger,
    signal,
  })
  const booked = await bookVenueFills(deps, result.fills, signal)
  const skipped = [...result.skipped, ...booked.skipped]
  const text = renderSyncResult(locale, result, {
    entries: booked.entries,
    skipped,
    marketData: deps.marketData,
    book: booked.book,
  })

  return { text, recorded: booked.entries.length, skipped: skipped.length }
}

/** Whether the venue can list what it filled, which is all a sync asks of it. */
export function canSyncFills(
  venue: Venue | null
): venue is Venue & { readonly adapter: SpotAdapter } {
  return venue?.adapter?.listFilledOrders !== undefined
}

function nothingBooked(text: string): VenueSyncOutcome {
  return { text, recorded: 0, skipped: 0 }
}

/** The book's own first row, every time. A watermark read off the newest row at the venue would be
 *  cheaper by a page or two and wrong in the ordinary case: a row dated D says a row exists, never
 *  that everything through D is recorded, so hand-recording today's trade and then syncing to catch
 *  up the rest would put the floor at today and report the months behind it as nothing to do. It
 *  also makes a fill an earlier run skipped reachable again once its cause clears. Everything before
 *  the first row is already counted in the opening snapshot that row states. */
async function resolveSyncWindow(
  deps: VenueSyncDeps,
  signal: AbortSignal
): Promise<SyncWindow | undefined> {
  const recorded = await deps.ledger.listAll(signal)
  const days = recorded.map((entry) => entry.transaction.at).sort()
  const fromDay = days[0]

  if (fromDay === undefined) {
    return undefined
  }

  const since = parseIsoDay(fromDay)

  return since === undefined ? undefined : { since, fromDay, recorded }
}
