import type { Logger } from '@/core/logging/logger'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { BinanceCredentials } from '@/trading/venues/binance/sign'
import type { Venue, VenueKeyRestrictions } from '@/trading/venues/types'
import { missingCredentials, resolveCredential } from '@/core/security/credentials'
import { marketRef, venueRef } from '@/trading/kernel/instrument'
import { createBinanceCatalog } from '@/trading/venues/binance/catalog'
import { fetchBinanceKeyRestrictions } from '@/trading/venues/binance/key'
import { createBinanceSpotAdapter } from '@/trading/venues/binance/spot'

const BINANCE_MARKETS: readonly MarketRef[] = Object.freeze([marketRef('crypto')])

interface BinanceVenueInput {
  readonly credentialEnv?: Readonly<Record<string, string>>
  readonly simulated: boolean
  /** Injected, never read from `process`: the names are code-owned config and only the value comes
   *  from the environment. */
  readonly env: Readonly<Record<string, string | undefined>>
  readonly logger: Logger
}

/** Without credentials Binance is a custodian the operator records trades against, as OKX is. With
 *  them it rests exits it cannot move and lists fills one symbol at a time, and the manifest says
 *  both. */
export function createBinanceVenue(input: BinanceVenueInput): Venue {
  const id = venueRef('binance')
  const credentials = resolveBinanceCredentials(input)
  const catalog = createBinanceCatalog()

  if (credentials === undefined) {
    return {
      manifest: {
        id,
        markets: BINANCE_MARKETS,
        acceptsOrders: false,
        missingCredentials: missingCredentials(input.env, input.credentialEnv),
      },
      catalog,
    }
  }

  return {
    manifest: {
      id,
      markets: BINANCE_MARKETS,
      acceptsOrders: true,
      execution: { exit: 'attached', amend: false, fills: 'by-symbol', balances: true },
    },
    adapter: createBinanceSpotAdapter({
      credentials,
      logger: input.logger,
      now: () => Date.now(),
    }),
    catalog,
  }
}

/** What the key the venue would load may do, or undefined when no key is loaded. Resolved exactly
 *  as `createBinanceVenue` resolves it, so the audit reads the key orders would go out on. */
export async function fetchBinanceKeyAudit(
  input: BinanceVenueInput,
  signal: AbortSignal
): Promise<VenueKeyRestrictions | undefined> {
  const credentials = resolveBinanceCredentials(input)

  if (credentials === undefined) {
    return undefined
  }

  return await fetchBinanceKeyRestrictions(
    { credentials, logger: input.logger, now: () => Date.now() },
    signal
  )
}

function resolveBinanceCredentials(input: BinanceVenueInput): BinanceCredentials | undefined {
  const names = input.credentialEnv

  if (names === undefined) {
    return undefined
  }

  const apiKey = resolveCredential(input.env, names.apiKey ?? '')
  const secret = resolveCredential(input.env, names.secret ?? '')

  if (apiKey === undefined || secret === undefined) {
    return undefined
  }

  return { apiKey, secret, simulated: input.simulated }
}
