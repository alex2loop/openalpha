import type { App } from '@/core/container'
import type { AlertFired, AlertFiredListener } from '@/trading/api'
import { toInstrumentWire } from '@/app/server/mappers/trading'
import { formatErrForLog } from '@/core/security/credentials'
import { t } from '@/i18n'
import { createDropLog, fireMatchingJobs } from '@/scheduler/api'
import { assertJobPrompt } from '@/tools/api'
import { alertId, formatInstant, formatPriceIn, quotedInOf } from '@/trading/api'

// The prompt a run reads when an alert started it, in the operator's language: the job's own prompt
// says what to do, this says why it is being done now.
function renderEventPrompt(app: App, fired: AlertFired): string {
  const { language, timezone } = app.config.locale
  const market = app
    .resolve('tradingHost')
    .describeMarkets(fired.firedAt)
    .markets.find((entry) => entry.market === fired.instrument.market)

  return t(language, 'scheduler.eventPrompt', {
    ticker: fired.instrument.ticker,
    what: t(language, `scheduler.event.${fired.event}`),
    time: formatInstant(language, fired.firedAt, timezone),
    price: formatPriceIn(
      language,
      fired.observedPrice,
      market === undefined ? {} : { currency: market.currency, ...quotedInOf(market) }
    ),
  })
}

/** What an alert's first send starts: the event jobs that wait on it. The listener is synchronous
 *  and returns at once; the runs go on under the daemon's signal, and the `runs` they are counted
 *  in is emptied on shutdown. */
export function createAlertFiredListener(app: App): AlertFiredListener {
  const runs = new Set<Promise<void>>()
  const logger = app.resolve('logger')
  const logDropped = createDropLog(logger)

  app.signal.addEventListener('abort', () => runs.clear(), { once: true })

  return (fired) => {
    const appendPrompt = renderEventPrompt(app, fired)

    try {
      assertJobPrompt(appendPrompt)
    } catch (err: unknown) {
      logger.warn('scheduler.event_prompt_rejected', { err: formatErrForLog(err) })
      return
    }

    fireMatchingJobs(
      {
        jobs: app.resolve('jobStore'),
        commands: app.resolve('schedulerCommands'),
        runs,
        logger,
        logDropped,
        signal: app.signal,
      },
      {
        alertId: fired.alertId,
        event: fired.event,
        instrument: toInstrumentWire(fired.instrument),
        condition: fired.condition,
        threshold: fired.threshold,
        observedPrice: fired.observedPrice,
        firedAt: fired.firedAt,
      },
      appendPrompt
    ).catch((err: unknown) => {
      logger.warn('scheduler.event_fire_failed', { err: formatErrForLog(err) })
    })
  }
}

/** Whether the alert a price job waits on can still fire. */
export function createAlertLiveCheck(app: App): (id: string) => Promise<boolean> {
  return (id) =>
    app.resolve('tradingHost').isAlertLive({ alertId: alertId(id), signal: app.signal })
}

/** Disables the alert a price job was armed with. It runs on the daemon's signal: the removal that
 *  asked for it is already done. */
export function createAlertRetirer(app: App): (id: string) => Promise<void> {
  return async (id) => {
    await app.resolve('tradingHost').disableAlert({ alertId: alertId(id), signal: app.signal })
  }
}
