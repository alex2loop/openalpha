import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { OperatorUse, ReadOperatorUse } from '@/trading/markets/operator-use'
import { createScopedValue } from '@/core/scoped-value'
import { formatErrForLog } from '@/core/security/credentials'
import { ttlCache } from '@/core/utils/collections'
import { disabledSegments } from '@/trading/kernel/operator/profile'
import { NOTHING_USED } from '@/trading/markets/operator-use'

const HELD_CACHE_TTL_MS = 5_000
const HELD_CACHE_KEY = 'held'
/** A local ledger and profile read; past this it is not coming back and the ticker resolves as it
 *  would for an operator who holds nothing. */
const HELD_READ_TIMEOUT_MS = 5_000

/** What the operator holds, watches and has switched off, read when a bare ticker needs a market
 *  chosen. The services
 *  that read it need the market registry this feeds, so each call resolves them at call time.
 *  Concurrent callers share one read. A name resolved from inside that read answers empty, which
 *  is what keeps valuing the book from waiting on itself; the marker follows the read's own async
 *  context, so an unrelated caller running beside it still sees the real answer. A failed read is
 *  logged and cached empty for the same few seconds, so a broken store is asked once, not on every
 *  resolution. A runtime without async tracking (a browser worker) cannot tell which caller sits
 *  inside the read, so every caller arriving while it is in flight answers empty: a bare ticker
 *  then reports the ambiguity instead of taking the held side, and concurrent callers no longer
 *  share the read. */
export function lazyOperatorUse(app: App, logger: Logger): ReadOperatorUse {
  const recent = ttlCache<string, OperatorUse>(HELD_CACHE_TTL_MS, 1)
  const inside = createScopedValue<true>()
  let inflight: Promise<OperatorUse> | undefined

  const read = async (): Promise<OperatorUse> => {
    try {
      const use = await readUse(app, AbortSignal.timeout(HELD_READ_TIMEOUT_MS))

      recent.set(HELD_CACHE_KEY, use)

      return use
    } catch (err: unknown) {
      logger.warn('trading.held_read_failed', { err: formatErrForLog(err) })
      recent.set(HELD_CACHE_KEY, NOTHING_USED)

      return NOTHING_USED
    }
  }

  return async () => {
    if (inside.get() === true || (!inside.tracksAsync && inflight !== undefined)) {
      return NOTHING_USED
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

async function readUse(app: App, signal: AbortSignal): Promise<OperatorUse> {
  const services = app.resolve('tradingServices')
  const [positions, profile] = await Promise.all([
    services.portfolio.positionsAt({ now: Date.now(), signal }),
    services.profiles.get({ signal }),
  ])
  const off = disabledSegments(profile.caps)

  return {
    instruments: [...positions.map((position) => position.instrument), ...profile.watchlist],
    switchedOff: new Set(services.profiles.heldSegments().filter((segment) => off.has(segment))),
  }
}
