import type { Logger } from '@/core/logging/logger'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { OkxCredentials } from '@/trading/venues/okx/sign'
import type { Venue } from '@/trading/venues/types'
import { missingCredentials, resolveCredential } from '@/core/security/credentials'
import { marketRef, venueRef } from '@/trading/kernel/instrument'
import { createOkxCatalog } from '@/trading/venues/okx/catalog'
import { createOkxSpotAdapter } from '@/trading/venues/okx/spot'

const OKX_MARKETS: readonly MarketRef[] = Object.freeze([marketRef('crypto')])

interface OkxVenueInput {
  readonly credentialEnv?: Readonly<Record<string, string>>
  readonly simulated: boolean
  /** Injected, never read from `process`: the names are code-owned config and only the value comes
   *  from the environment. */
  readonly env: Readonly<Record<string, string | undefined>>
  readonly logger: Logger
}

/** Without credentials OKX is still a custodian the operator holds coins at and records trades
 *  against — it simply cannot be placed on, which is what `acceptsOrders: false` says. One factory
 *  either way, so the markets OKX holds are written down once. The catalog rides both branches
 *  because listing is public: what the exchange carries never needed the credentials. */
export function createOkxVenue(input: OkxVenueInput): Venue {
  const id = venueRef('okx')
  const credentials = resolveCredentials(input)
  const catalog = createOkxCatalog()

  if (credentials === undefined) {
    return {
      manifest: {
        id,
        markets: OKX_MARKETS,
        acceptsOrders: false,
        missingCredentials: missingCredentials(input.env, input.credentialEnv),
      },
      catalog,
    }
  }

  return {
    manifest: {
      id,
      markets: OKX_MARKETS,
      acceptsOrders: true,
      execution: { exit: 'attached', amend: true, fills: 'enumerable', balances: true },
    },
    adapter: createOkxSpotAdapter({ credentials, logger: input.logger, now: () => Date.now() }),
    catalog,
  }
}

/** Undefined when any of the three is unset, which is what leaves the venue a custodian with no
 *  client: the operator still records trades against it and simply sees no `/trade`, rather than
 *  one that fails at the moment they use it. Boot continues. */
function resolveCredentials(input: OkxVenueInput): OkxCredentials | undefined {
  const names = input.credentialEnv

  if (names === undefined) {
    return undefined
  }

  const apiKey = resolveCredential(input.env, names.apiKey ?? '')
  const secret = resolveCredential(input.env, names.secret ?? '')
  const passphrase = resolveCredential(input.env, names.passphrase ?? '')

  if (apiKey === undefined || secret === undefined || passphrase === undefined) {
    return undefined
  }

  return { apiKey, secret, passphrase, simulated: input.simulated }
}
