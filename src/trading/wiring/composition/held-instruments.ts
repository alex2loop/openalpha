import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { HeldInstruments } from '@/trading/markets/resolution'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { ttlCache } from '@/core/utils/collections'

const HELD_CACHE_TTL_MS = 5_000
const HELD_CACHE_KEY = 'held'

/** What the operator holds or watches, read when a bare ticker needs a side chosen. The services
 *  that read it need the market registry this feeds, so each call resolves them at call time. A
 *  read that is already running answers empty to a nested ask, which is what keeps resolving a
 *  name while valuing the book from waiting on itself. A failed read leaves the ticker to resolve
 *  as it would for an operator who holds nothing. */
export function lazyHeldInstruments(app: App, logger: Logger): HeldInstruments {
  const recent = ttlCache<string, readonly InstrumentRef[]>(HELD_CACHE_TTL_MS, 1)
  let reading = false

  return async (signal) => {
    const cached = recent.get(HELD_CACHE_KEY)

    if (cached !== undefined || reading) {
      return cached ?? []
    }

    reading = true

    try {
      const held = await readHeld(app, signal)

      recent.set(HELD_CACHE_KEY, held)

      return held
    } catch (err: unknown) {
      if (isAbortError(err)) {
        throw err
      }

      logger.warn('trading.held_read_failed', { err: formatErrForLog(err) })

      return []
    } finally {
      reading = false
    }
  }
}

async function readHeld(app: App, signal: AbortSignal): Promise<readonly InstrumentRef[]> {
  const services = app.resolve('tradingServices')
  const [positions, profile] = await Promise.all([
    services.portfolio.positionsAt({ now: Date.now(), signal }),
    services.profiles.get({ defaultLocale: app.config.locale.language, signal }),
  ])

  return [...positions.map((position) => position.instrument), ...profile.watchlist]
}
