import type { Logger } from '@/core/logging/logger'
import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import type { LedgerStore } from '@/trading/features/ledger/store/ledger'
import type { LedgerEntry } from '@/trading/features/ledger/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { TradingCosts } from '@/trading/kernel/config'
import type { TradingDay, VenueRef } from '@/trading/kernel/instrument'
import type { MarketRegistry } from '@/trading/markets/types'
import type { Venue, VenueRegistry } from '@/trading/venues/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { parseIsoDay } from '@/core/utils/time'
import { t } from '@/i18n'
import { parseLedgerDraft, parseSyncRequest } from '@/trading/features/ledger/draft'
import { renderWriteConfirmation } from '@/trading/features/ledger/render'
import { resolveVenueSync, type SkippedFill, type SyncedFill } from '@/trading/features/ledger/sync'
import { renderSyncResult } from '@/trading/features/ledger/sync-render'
import { LEDGER_TXN_KINDS } from '@/trading/features/ledger/types'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { usage } from '@/trading/kernel/surface/surface'
import { renderVenueName, resolveRenderContext } from '@/trading/render/format'

const USAGE: 'slash.tradingRecordUsage' = 'slash.tradingRecordUsage'
const VOID_TIMEOUT_MS = 30_000

type Recorder = Pick<PortfolioService, 'record' | 'remove'>

interface RecordCommandDeps {
  readonly portfolio: Recorder
  readonly marketData: Pick<MarketDataService, 'quoteConvention' | 'trailsStop' | 'boardLot'>
  readonly costs: TradingCosts
  readonly timezone: string
  readonly venues: VenueRegistry
  readonly markets: MarketRegistry
  readonly ledger: Pick<LedgerStore, 'listAll' | 'findByIdempotency'>
  readonly logger: Logger
}

/** How far back a sync reaches, which is also the day before which it books nothing. */
interface SyncWindow {
  readonly since: number
  readonly fromDay: TradingDay
  readonly recorded: readonly LedgerEntry[]
}

export function createRecordCommand(deps: RecordCommandDeps): SlashCommand {
  return {
    name: 'record',
    description: { kind: 'localized', key: 'slash.tradingRecordHelp' },
    messageKeys: [USAGE],
    policy: {
      surfaces: ['channel', 'repl'],
      role: 'operator',
      action: 'mutate',
      idempotencyKey: (ctx) => ctx.requestId,
    },
    completeFor: (args) => (args.length === 1 ? LEDGER_TXN_KINDS : []),
    run: async (ctx): Promise<SlashResult> => run(deps, ctx),
  }
}

async function run(deps: RecordCommandDeps, ctx: SlashContext): Promise<SlashResult> {
  const venue = parseSyncRequest(ctx.args)

  if (venue !== null) {
    return runSync(deps, ctx, venue)
  }

  const draft = parseLedgerDraft(ctx.args)

  if (draft === null) {
    return recordUsage(deps)
  }

  const result = await deps.portfolio.record({
    draft,
    idempotencyKey: ctx.requestId,
    now: Date.now(),
    signal: ctx.signal,
  })

  return {
    kind: 'text',
    text: renderWriteConfirmation(ctx.locale, result, {
      ...deps,
      context: resolveRenderContext(deps.timezone, ctx.surface),
    }),
  }
}

/** Only markets a venue holds: the ledger refuses a row in any other, so the usage never offers
 *  one. */
function recordUsage(deps: RecordCommandDeps): SlashResult {
  const held = deps.venues.heldMarkets()
  const markets = deps.markets
    .list()
    .map((entry) => entry.manifest.id)
    .filter((market) => held.has(market))

  return usage(USAGE, { markets: markets.join(', ') })
}

/** Booked one at a time, oldest first: each write re-folds the whole book, so a buy has to land
 *  before the sale that closes it or the validator refuses a sell the book cannot yet cover. */
async function runSync(
  deps: RecordCommandDeps,
  ctx: SlashContext,
  venue: VenueRef
): Promise<SlashResult> {
  const found = deps.venues.find(venue)

  if (found?.adapter === undefined || found.adapter.listFilledOrders === undefined) {
    const known = deps.venues.list().map((entry) => entry.manifest.id)

    return {
      kind: 'text',
      text: renderSyncUnavailable(ctx.locale, { venue, found, known }),
    }
  }

  const window = await resolveSyncWindow(deps, ctx.signal)

  if (window === undefined) {
    return { kind: 'text', text: t(ctx.locale, 'trading.render.ledger.syncNoBook') }
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
    signal: ctx.signal,
  })
  const booked = await bookFills(deps, ctx, result.fills)
  const { entries, skipped } = await voidPartialInstruments(deps, ctx.signal, booked)

  return {
    kind: 'text',
    text: renderSyncResult(ctx.locale, result, {
      entries,
      skipped: [...result.skipped, ...skipped],
      marketData: deps.marketData,
    }),
  }
}

interface SyncUnavailableInput {
  readonly venue: VenueRef
  readonly found: Venue | null
  readonly known: readonly VenueRef[]
}

/** Why `/record sync` reads nothing from a venue: none by that name, one waiting for its key, or
 *  one traded by hand. */
function renderSyncUnavailable(locale: Locale, input: SyncUnavailableInput): string {
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
    : t(locale, 'trading.render.ledger.syncKeyless', { venue, variables: missing.join(', ') })
}

/** What one pass over the fills left behind: the rows it wrote, the fills it could not write, and
 *  the instruments at least one fill of which was refused. */
interface BookedFills {
  readonly entries: readonly LedgerEntry[]
  readonly skipped: readonly SkippedFill[]
  readonly partial: ReadonlySet<string>
}

/** Oldest first across every instrument, because the write order is the economic one: a buy has to
 *  land before the sale that closes it, and before a purchase elsewhere spends the cash it needs. */
async function bookFills(
  deps: RecordCommandDeps,
  ctx: SlashContext,
  fills: readonly SyncedFill[]
): Promise<BookedFills> {
  const entries: LedgerEntry[] = []
  const skipped: SkippedFill[] = []
  const partial = new Set<string>()
  const booked: BookedFills = { entries, skipped, partial }

  for (const [index, fill] of fills.entries()) {
    try {
      const entry = await recordFill(deps, ctx, fill)

      if (entry === undefined) {
        partial.add(buildInstrumentKey(fill.draft.instrument))
        skipped.push({ symbol: fill.symbol, reason: 'refused' })
        continue
      }

      entries.push(entry)
    } catch (err: unknown) {
      await voidAfterFailure(deps, booked, fills.slice(index))

      throw err
    }
  }

  return booked
}

/** A throw mid-pass (a cancel included) leaves every name it had not finished half booked, the fill
 *  in flight too: it may have landed before the throw, so it is looked up by its key. Best effort
 *  under its own bound, because a cancel has spent the caller's signal; what it cannot void is
 *  logged and the original error still stands. */
async function voidAfterFailure(
  deps: RecordCommandDeps,
  booked: BookedFills,
  pending: readonly SyncedFill[]
): Promise<void> {
  const signal = AbortSignal.timeout(VOID_TIMEOUT_MS)

  try {
    const inFlight = pending[0]
    const landed =
      inFlight === undefined
        ? null
        : await deps.ledger.findByIdempotency({ idempotencyKey: inFlight.idempotencyKey, signal })

    const entries = landed === null ? booked.entries : [...booked.entries, landed.entry]
    const partial = new Set(booked.partial)

    for (const fill of pending) {
      partial.add(buildInstrumentKey(fill.draft.instrument))
    }

    await voidPartialInstruments(deps, signal, { entries, skipped: booked.skipped, partial })
  } catch (err: unknown) {
    deps.logger.warn('ledger.sync_cleanup_failed', { err: formatErrForLog(err) })
  }
}

/** A name the book could take only part of is taken not at all. Six of a name's thirty fills state
 *  a position that never existed and a cost basis nothing later can correct, and every reading taken
 *  from it — the sizing, the record, the exit plan — is wrong in a way no surface can show. Removed
 *  newest first, so the book passes through no state it would have refused on the way in. */
async function voidPartialInstruments(
  deps: RecordCommandDeps,
  signal: AbortSignal,
  booked: BookedFills
): Promise<{ readonly entries: readonly LedgerEntry[]; readonly skipped: readonly SkippedFill[] }> {
  if (booked.partial.size === 0) {
    return { entries: booked.entries, skipped: booked.skipped }
  }

  const now = Date.now()
  const kept: LedgerEntry[] = []
  const voided: SkippedFill[] = []

  for (const entry of [...booked.entries].reverse()) {
    const instrument = 'instrument' in entry.transaction ? entry.transaction.instrument : undefined

    if (instrument === undefined || !booked.partial.has(buildInstrumentKey(instrument))) {
      kept.push(entry)
      continue
    }

    if (await isVoided(deps, { entry, now, signal })) {
      voided.push({ symbol: instrument.ticker, reason: 'partial' })
      continue
    }

    kept.push(entry)
  }

  return { entries: kept.reverse(), skipped: [...booked.skipped, ...voided] }
}

/** Removing a row re-folds the book, and a sale's proceeds leaving can put a later purchase short of
 *  cash, so this can refuse. The row then stays, is reported as recorded, and its name is still
 *  reported partial — which is the honest pair, since both are true of the book as it now stands. */
async function isVoided(
  deps: RecordCommandDeps,
  removal: { readonly entry: LedgerEntry; readonly now: number; readonly signal: AbortSignal }
): Promise<boolean> {
  try {
    await deps.portfolio.remove({
      ref: removal.entry.id,
      now: removal.now,
      signal: removal.signal,
    })

    return true
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('ledger.sync_void_failed', {
      entryId: removal.entry.id,
      err: formatErrForLog(err),
    })

    return false
  }
}

/** One fill at a time, because the book is folded and validated per row. A refusal stops that row
 *  and no other here; what it costs the rest of its instrument is decided afterwards, once the pass
 *  has seen every fill that name had. */
async function recordFill(
  deps: RecordCommandDeps,
  ctx: SlashContext,
  fill: SyncedFill
): Promise<LedgerEntry | undefined> {
  try {
    const write = await deps.portfolio.record({
      draft: fill.draft,
      idempotencyKey: fill.idempotencyKey,
      // The figures are already the venue's own, which both records the provenance and stops the
      // write path from asking it for a fill this command just read.
      fillSource: 'venue',
      now: Date.now(),
      signal: ctx.signal,
    })

    return write.entry
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('ledger.sync_fill_refused', {
      venue: fill.draft.venue,
      ticker: fill.draft.instrument.ticker,
      at: fill.draft.at,
      err: formatErrForLog(err),
    })

    return undefined
  }
}

/** The book's own first row, every time. A watermark read off the newest row at the venue would be
 *  cheaper by a page or two and wrong in the ordinary case: a row dated D says a row exists, never
 *  that everything through D is recorded, so hand-recording today's trade and then syncing to catch
 *  up the rest would put the floor at today and report the months behind it as nothing to do. It
 *  also makes a fill an earlier run skipped reachable again once its cause clears. Everything before
 *  the first row is already counted in the opening snapshot that row states. */
async function resolveSyncWindow(
  deps: RecordCommandDeps,
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
