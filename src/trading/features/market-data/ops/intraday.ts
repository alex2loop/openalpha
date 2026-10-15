import type { Logger } from '@/core/logging/logger'
import type { IntradayReportDeps } from '@/trading/features/market-data/intraday/report'
import type { IntradayPlan } from '@/trading/features/market-data/intraday/schedule'
import type { IntradaySettingsStore } from '@/trading/features/market-data/store/intraday-settings'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { TradingNoticeSender } from '@/trading/kernel/operator/notice'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { buildIntradayReport } from '@/trading/features/market-data/intraday/report'
import { nextIntradayFireAt } from '@/trading/features/market-data/intraday/schedule'
import { sendCaught } from '@/trading/kernel/operator/delivery-retry'

/** How long the loop sleeps when nothing is scheduled - an empty `send_times`, or a calendar with
 *  no trading day ahead. Long enough to cost nothing, short enough that a config reload is picked
 *  up without a restart. */
export const IDLE_DELAY_MS = 3_600_000

interface IntradayTickDeps extends IntradayReportDeps {
  readonly plan: IntradayPlan
  readonly settings: IntradaySettingsStore
  readonly sender: TradingNoticeSender
  recipient(): DeliveryAddress | undefined
  readonly logger: Logger
}

export function nextIntradayDelayMs(plan: IntradayPlan, now: number, ceilingMs: number): number {
  const at = nextIntradayFireAt(plan, now)

  return at === null ? ceilingMs : Math.max(0, at - now)
}

export function createIntradayTick(deps: IntradayTickDeps): (signal: AbortSignal) => Promise<void> {
  return async (signal) => {
    const now = Date.now()
    const { plan } = deps

    if (plan.sendTimes.length === 0) {
      return
    }

    // No log line: a disabled schedule firing nothing is the operator's own decision, and a
    // twice-daily "still disabled" line is noise that would outlive their memory of setting it.
    if (!(await deps.settings.isEnabled(signal))) {
      return
    }

    const target = deps.recipient()

    if (target === undefined) {
      deps.logger.debug('trading.intraday_no_recipient', { market: plan.market.manifest.id })
      return
    }

    await sendReport(deps, { plan, target, now, signal })
  }
}

interface SendContext {
  readonly plan: IntradayPlan
  readonly target: DeliveryAddress
  readonly now: number
  readonly signal: AbortSignal
}

/** An abort rethrows - shutdown is not a delivery failure. Every other throw is swallowed with a
 *  log, because one bad fire must not kill the loop. */
async function sendReport(deps: IntradayTickDeps, context: SendContext): Promise<void> {
  try {
    const report = await buildIntradayReport(deps, {
      plan: context.plan,
      now: context.now,
      signal: context.signal,
    })
    const outcome = await sendCaught(
      deps.sender,
      { target: context.target, locale: deps.locale, payload: { kind: 'intraday', report } },
      context.signal
    )

    if (outcome !== 'accepted') {
      deps.logger.warn('trading.intraday_undelivered', { outcome })
    }
  } catch (err: unknown) {
    if (isAbortError(err) || context.signal.aborted) {
      throw err
    }

    deps.logger.warn('trading.intraday_failed', { err: formatErrForLog(err) })
  }
}
