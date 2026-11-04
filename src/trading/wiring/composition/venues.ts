import type { Logger } from '@/core/logging/logger'
import type { LedgerStore } from '@/trading/features/ledger/store/ledger'
import type { TradingConfig } from '@/trading/kernel/config'
import type { VenueListings } from '@/trading/kernel/venue/catalog'
import type { VenueRegistry } from '@/trading/venues/types'
import type { TradingEdition } from '@/trading/wiring/composition/edition'
import { TRADE_COMMAND_NAME } from '@/trading/features/order/types'
import { marketRef, venueRef } from '@/trading/kernel/instrument'
import { createBinanceVenue } from '@/trading/venues/binance/venue'
import { createVenueListings } from '@/trading/venues/listings'
import { createManualVenue } from '@/trading/venues/manual'
import { createOkxVenue } from '@/trading/venues/okx/venue'
import { createVenueRegistry } from '@/trading/venues/registry'
import { isMarketBuilt } from '@/trading/wiring/composition/edition'

interface VenueOptions {
  readonly tradingConfig: TradingConfig
  /** A hand-traded venue holding a market the edition does not build is left out. */
  readonly edition?: TradingEdition | undefined
  readonly env: Readonly<Record<string, string | undefined>>
}

interface BuiltVenues {
  readonly registry: VenueRegistry
  /** What the crypto screen may rank: the catalogs of the venues this book trades at. */
  readonly listings: VenueListings
}

/** VPS, the gold shop and every broker the operator declares are recorded, never placed on. OKX and
 *  Binance register either way: without credentials each is a custodian with no client. */
export function buildVenues(
  options: VenueOptions,
  deps: {
    readonly logger: Logger
    readonly book: Pick<LedgerStore, 'listVenues'>
  }
): BuiltVenues {
  const { logger } = deps
  const venues = createVenueRegistry(logger)

  registerVenues(venues, options, logger)

  return {
    registry: venues,
    listings: createVenueListings({
      venues,
      defaultVenues: options.tradingConfig.defaultVenues,
      book: deps.book,
      logger,
    }),
  }
}

function registerVenues(venues: VenueRegistry, options: VenueOptions, logger: Logger): void {
  const okx = options.tradingConfig.venues[venueRef('okx')]
  const binance = options.tradingConfig.venues[venueRef('binance')]

  venues.register(
    createOkxVenue({
      simulated: okx?.simulated ?? false,
      env: options.env,
      logger,
      ...(okx === undefined ? {} : { credentialEnv: okx.credentialEnv }),
    })
  )
  venues.register(
    createBinanceVenue({
      simulated: binance?.simulated ?? false,
      env: options.env,
      logger,
      ...(binance === undefined ? {} : { credentialEnv: binance.credentialEnv }),
    })
  )
  registerManual(venues, options, { id: venueRef('vps'), markets: [marketRef('equity-vn')] })
  registerManual(venues, options, { id: venueRef('gold-shop'), markets: [marketRef('gold-vn')] })
  registerManual(venues, options, { id: venueRef('us-broker'), markets: [marketRef('equity-us')] })

  // Only a declared broker carries `markets`; a built-in venue's are the lines above.
  for (const [id, config] of Object.entries(options.tradingConfig.venues)) {
    if (config?.markets !== undefined) {
      registerManual(venues, options, { id: venueRef(id), markets: config.markets })
    }
  }

  venues.close()

  // A missing exchange key matters only where orders can be placed; an edition without `/trade`
  // never reads one.
  if (options.edition?.commands?.has(TRADE_COMMAND_NAME) === false) {
    return
  }

  for (const venue of venues.list()) {
    const { id, missingCredentials } = venue.manifest

    if (missingCredentials !== undefined) {
      logger.warn('trading.order_credentials_missing', { venue: id, variables: missingCredentials })
    }
  }
}

function registerManual(
  venues: VenueRegistry,
  options: VenueOptions,
  venue: Parameters<typeof createManualVenue>[0]
): void {
  if (venue.markets.every((market) => isMarketBuilt(options.edition, market))) {
    venues.register(createManualVenue(venue))
  }
}
