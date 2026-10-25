import { useSignal } from '@preact/signals'

import type { AlertWire } from '@/app/server/wire/market'
import { formatDay } from '@/i18n'
import { findQuote } from '@/web/state/market'
import { locale, state } from '@/web/state/session'
import { disableAlert, restoreAlert } from '@/web/state/watch'
import { formatMarketPrice } from '@/web/text/market-price'
import { buildDayKey, formatWhen } from '@/web/text/time'
import { toErrorText, tr } from '@/web/text/tr'
import { CloseIcon } from '@/web/ui/kit/icons'
import { showUndo } from '@/web/ui/kit/undo-bar'
import { TickerLink } from '@/web/ui/ticker/ticker-link'

import './book.css'

interface AlertRowProps {
  readonly alert: AlertWire
  /** Off on a ticker card, which is already about the name. */
  readonly withTicker: boolean
}

/** An alert you set: "Khi giá chạm hoặc thủng 27,80", when it was set, when it fired, and a way to
 *  delete it that can be taken back. */
export function AlertRow({ alert, withTicker }: AlertRowProps) {
  const failure = useSignal<string | undefined>(undefined)
  const dir = tr(`trading.alert.condition.${alert.condition}`)
  const level = formatMarketPrice(
    alert.instrument.market,
    alert.threshold,
    findQuote(alert.instrument.ticker, alert.instrument.market)?.kind
  )

  return (
    <>
      <div class="row alert-row">
        <AlertText alert={alert} withTicker={withTicker} words={{ dir, level }} />
        <AlertSetDate createdAt={alert.createdAt} />
        <button
          type="button"
          class="icon-button is-small"
          title={tr('ui.office.book.alertRemove')}
          aria-label={tr('ui.office.book.alertRemove')}
          onClick={() => remove(alert, { dir, level }, failure)}
        >
          <CloseIcon />
        </button>
      </div>
      {failure.value !== undefined && <p class="failure-line">{failure.value}</p>}
    </>
  )
}

interface AlertTextProps extends AlertRowProps {
  readonly words: { readonly dir: string; readonly level: string }
}

function AlertText({ alert, withTicker, words }: AlertTextProps) {
  const timeZone = state.value?.timeZone
  const firedAt =
    alert.state === 'active' || alert.state === 'disabled'
      ? undefined
      : (alert.firedAt ?? alert.triggeredAt)

  return (
    <span>
      {withTicker && (
        <b>
          <TickerLink ticker={alert.instrument.ticker} market={alert.instrument.market} />{' '}
        </b>
      )}
      {tr('ui.office.book.alertLine', words)}
      {firedAt !== undefined && timeZone !== undefined && (
        <span class="alert-fired">
          {' '}
          {tr('ui.office.book.alertFired', { time: formatWhen(firedAt, timeZone) })}
        </span>
      )}
    </span>
  )
}

function AlertSetDate({ createdAt }: { readonly createdAt: number }) {
  const timeZone = state.value?.timeZone

  if (timeZone === undefined) {
    return <span />
  }

  return (
    <span class="meta">
      {tr('ui.office.book.alertSet', {
        date: formatDay(locale.value, buildDayKey(createdAt, timeZone)),
      })}
    </span>
  )
}

function remove(
  alert: AlertWire,
  words: { readonly dir: string; readonly level: string },
  failure: { value: string | undefined }
): void {
  failure.value = undefined
  disableAlert(alert.id).then(
    (result) => {
      if (result === 'disabled') {
        showUndo(
          tr('ui.office.book.undoAlert', { ticker: alert.instrument.ticker, ...words }),
          () => restoreAlert(alert).then(() => undefined)
        )
      }
    },
    (error: unknown) => {
      failure.value = toErrorText(error)
    }
  )
}
