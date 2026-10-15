import type { VenueConfigs } from '@/trading/kernel/config'
import type { VenueKeyRestrictions } from '@/trading/venues/types'
import { silentLogger } from '@/core/logging/logger'
import { OrderError } from '@/trading/features/order/types'
import { venueRef } from '@/trading/kernel/instrument'
import { fetchBinanceKeyAudit } from '@/trading/venues/binance/venue'

export type VenueKeyAudit =
  | ({ readonly venue: string; readonly kind: 'audited' } & VenueKeyRestrictions)
  | { readonly venue: string; readonly kind: 'failed'; readonly code: string }

interface AuditVenueKeysOptions {
  readonly venues: VenueConfigs
  readonly env: Readonly<Record<string, string | undefined>>
  readonly signal: AbortSignal
}

/** Live keys only: a demo key moves no real money, so there is nothing for the audit to protect. */
export async function auditVenueKeys(
  options: AuditVenueKeysOptions
): Promise<readonly VenueKeyAudit[]> {
  const venue = venueRef('binance')
  const config = options.venues[venue]

  if (config === undefined || config.simulated) {
    return []
  }

  try {
    const restrictions = await fetchBinanceKeyAudit(
      {
        credentialEnv: config.credentialEnv,
        simulated: false,
        env: options.env,
        logger: silentLogger,
      },
      options.signal
    )

    if (restrictions === undefined) {
      return []
    }

    return [{ venue, kind: 'audited', ...restrictions }]
  } catch (err: unknown) {
    return [{ venue, kind: 'failed', code: err instanceof OrderError ? err.code : 'order.network' }]
  }
}
