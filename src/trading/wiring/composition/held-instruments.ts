import { AsyncLocalStorage } from 'node:async_hooks'

import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { HeldInstruments } from '@/trading/markets/resolution'
import { formatErrForLog } from '@/core/security/credentials'
import { ttlCache } from '@/core/utils/collections'

const HELD_CACHE_TTL_MS = 5_000
const HELD_CACHE_KEY = 'held'
/** A local ledger and profile read; past this it is not coming back and the ticker resolves as it
 *  would for an operator who holds nothing. */
const HELD_READ_TIMEOUT_MS = 5_000

/** What the operator holds or watches, read when a bare ticker needs a side chosen. The services
 *  that read it need the market registry this feeds, so each call resolves them at call time.
 *  Concurrent callers share one read. A name resolved from inside that read answers empty, which
 *  is what keeps valuing the book from waiting on itself; the marker follows the read's own async
 *  context, so an unrelated caller running beside it still sees the real answer. A failed read is
 *  logged and cached empty for the same few seconds, so a broken store is asked once, not on every
 *  resolution. */
export function lazyHeldInstruments(app: App, logger: Logger): HeldInstruments {
  const recent = ttlCache<string, readonly InstrumentRef[]>(HELD_CACHE_TTL_MS, 1)
  const inside = new AsyncLocalStorage<true>()
  let inflight: Promise<readonly InstrumentRef[]> | undefined

  const read = async (): Promise<readonly InstrumentRef[]> => {
    try {
      const held = await readHeld(app, AbortSignal.timeout(HELD_READ_TIMEOUT_MS))

      recent.set(HELD_CACHE_KEY, held)

      return held
    } catch (err: unknown) {
      logger.warn('trading.held_read_failed', { err: formatErrForLog(err) })
      recent.set(HELD_CACHE_KEY, [])

      return []
    }
  }

  return async () => {
    if (inside.getStore() === true) {
      return []
    }

    const cached = recent.get(HELD_CACHE_KEY)

    if (cached !== undefined) {
      return cached
    }

    inflight ??= inside.run(true, read).finally(() => {
      inflight = undefined
    })

    return inflight
  }
}

async function readHeld(app: App, signal: AbortSignal): Promise<readonly InstrumentRef[]> {
  const services = app.resolve('tradingServices')
  const [positions, profile] = await Promise.all([
    services.portfolio.positionsAt({ now: Date.now(), signal }),
    services.profiles.get({ signal }),
  ])

  return [...positions.map((position) => position.instrument), ...profile.watchlist]
}
