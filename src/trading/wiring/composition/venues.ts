import type { Logger } from '@/core/logging/logger'
import type { TradingConfig } from '@/trading/kernel/config'
import type { VenueRegistry } from '@/trading/venues/types'
import { marketRef, venueRef } from '@/trading/kernel/instrument'
import { createBinanceVenue } from '@/trading/venues/binance/venue'
import { createManualVenue } from '@/trading/venues/manual'
import { createOkxVenue } from '@/trading/venues/okx/venue'
import { createVenueRegistry } from '@/trading/venues/registry'

interface VenueOptions {
  readonly tradingConfig: TradingConfig
  readonly env: Readonly<Record<string, string | undefined>>
}

/** VPS, the gold shop and every broker the operator declares are recorded, never placed on. OKX and
 *  Binance register either way: without credentials each is a custodian with no client. */
export function buildVenues(options: VenueOptions, logger: Logger): VenueRegistry {
  const venues = createVenueRegistry(logger)
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
  venues.register(createManualVenue({ id: venueRef('vps'), markets: [marketRef('equity-vn')] }))
  venues.register(createManualVenue({ id: venueRef('gold-shop'), markets: [marketRef('gold-vn')] }))

  // Only a declared broker carries `markets`; a built-in venue's are the lines above.
  for (const [id, config] of Object.entries(options.tradingConfig.venues)) {
    if (config?.markets !== undefined) {
      venues.register(createManualVenue({ id: venueRef(id), markets: config.markets }))
    }
  }

  venues.close()

  for (const venue of venues.list()) {
    const { id, missingCredentials } = venue.manifest

    if (missingCredentials !== undefined) {
      logger.warn('trading.order_credentials_missing', { venue: id, variables: missingCredentials })
    }
  }

  return venues
}
