import type { Logger } from '@/core/logging/logger'
import type { NavSnapshotStore, NavSnapshotTick } from '@/trading/features/portfolio/nav/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { dayInZone } from '@/core/utils/time'
import { tradingDay } from '@/trading/kernel/instrument'

interface NavSnapshotDeps {
  readonly portfolio: Pick<PortfolioService, 'viewAbsolute'>
  readonly store: Pick<NavSnapshotStore, 'upsert'>
  readonly timezone: string
  readonly logger: Logger
}

async function writeSnapshot(deps: NavSnapshotDeps, signal: AbortSignal): Promise<void> {
  const now = Date.now()
  const valued = await deps.portfolio.viewAbsolute({ now, signal })
  const { book } = valued

  if (book.positions.length === 0 && book.cashBase === 0 && book.netDepositsBase === 0) {
    return
  }

  if (valued.navBase === undefined) {
    const unpriced = valued.positions.flatMap((entry) =>
      entry.kind === 'unpriced' ? [entry.position.instrument.ticker] : []
    )

    deps.logger.warn('trading.nav_snapshot_skipped', {
      unpriced,
      caveats: valued.caveats.map((caveat) => ({ code: caveat.code, detail: caveat.detail })),
    })

    return
  }

  await deps.store.upsert(
    {
      day: tradingDay(dayInZone(now, deps.timezone)),
      baseCurrency: book.baseCurrency,
      navBase: valued.navBase,
      cashBase: book.cashBase,
      netDepositsBase: book.netDepositsBase,
      recordedAt: now,
    },
    signal
  )
}

/** Total by contract: a refresh pass never fails because the book could not be priced. */
export function createNavSnapshotTick(deps: NavSnapshotDeps): NavSnapshotTick {
  return async (signal) => {
    try {
      await writeSnapshot(deps, signal)
    } catch (err: unknown) {
      if (isAbortError(err)) {
        throw err
      }

      deps.logger.warn('trading.nav_snapshot_failed', { err: formatErrForLog(err) })
    }
  }
}
