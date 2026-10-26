import { type Signal, useSignal } from '@preact/signals'

import type { AlertWire } from '@/app/server/wire/market'
import type { InstrumentRefWire, TradingProfileResponse } from '@/app/server/wire/trading'
import { readBlock } from '@/web/state/block'
import { findQuote, keyOf, profileBlock } from '@/web/state/market'
import { addWatch, qualifyName, removeWatch, useAlerts } from '@/web/state/watch'
import { formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { formatMarketPrice } from '@/web/text/market-price'
import { toErrorText, tr } from '@/web/text/tr'
import { AlertRow } from '@/web/ui/book/alert-row'
import { Button } from '@/web/ui/kit/button'
import { BellIcon, CloseIcon, ListIcon } from '@/web/ui/kit/icons'
import { showUndo } from '@/web/ui/kit/undo-bar'
import { TickerLink } from '@/web/ui/ticker/ticker-link'
import { BlockFrame } from '@/web/ui/today/block-frame'

import './book.css'

/** Theo dõi: the names you watch, and the price alerts you set. */
export function Watch() {
  const alerts = useAlerts()

  return (
    <>
      <BlockFrame
        title={tr('ui.office.book.watchTitle')}
        colour="blue"
        icon={<ListIcon />}
        reading={readBlock(profileBlock)}
      >
        {(profile) => <WatchList profile={profile} />}
      </BlockFrame>
      <BlockFrame
        title={tr('ui.office.common.priceAlerts')}
        colour="pink"
        icon={<BellIcon />}
        reading={alerts}
      >
        {(answer) => <AlertList alerts={answer.alerts} />}
      </BlockFrame>
    </>
  )
}

function WatchList({ profile }: { readonly profile: TradingProfileResponse }) {
  const failure = useSignal<string | undefined>(undefined)

  return (
    <>
      {profile.watchlist.length === 0 ? (
        <p class="meta">{tr('ui.office.book.watchEmpty')}</p>
      ) : (
        <div class="row-list">
          {profile.watchlist.map((instrument) => (
            <WatchRow key={keyOf(instrument)} instrument={instrument} failure={failure} />
          ))}
        </div>
      )}
      {failure.value !== undefined && <p class="failure-line">{failure.value}</p>}
      <AddName failure={failure} />
    </>
  )
}

interface WatchRowProps {
  readonly instrument: InstrumentRefWire
  readonly failure: Signal<string | undefined>
}

function WatchRow({ instrument, failure }: WatchRowProps) {
  const quote = findQuote(instrument.ticker, instrument.market)

  return (
    <div class="row">
      <b>
        <TickerLink ticker={instrument.ticker} market={instrument.market} />
      </b>
      <span>{formatMarketPrice(instrument.market, quote?.last, quote?.kind)}</span>
      <span class="row-end">
        <span class={`pill is-${toneOfPercent(quote?.changePct)}`}>
          {formatSignedPercent(quote?.changePct)}
        </span>
        <button
          type="button"
          class="icon-button is-small"
          title={tr('ui.office.book.watchRemove')}
          aria-label={tr('ui.office.book.watchRemove')}
          onClick={() => unwatch(instrument, failure)}
        >
          <CloseIcon />
        </button>
      </span>
    </div>
  )
}

function unwatch(instrument: InstrumentRefWire, failure: Signal<string | undefined>): void {
  failure.value = undefined
  removeWatch(instrument).then(
    () =>
      showUndo(tr('ui.office.book.undoWatch', { ticker: instrument.ticker }), {
        undo: () => addWatch(qualifyName(instrument)),
      }),
    (error: unknown) => {
      failure.value = toErrorText(error)
    }
  )
}

function AddName({ failure }: { readonly failure: Signal<string | undefined> }) {
  const name = useSignal('')
  const isBusy = useSignal(false)

  return (
    <form
      class="add-name"
      onSubmit={(event) => {
        event.preventDefault()
        submitName({ name, isBusy, failure })
      }}
    >
      <input
        type="text"
        value={name.value}
        placeholder={tr('ui.office.book.addPlaceholder')}
        aria-label={tr('ui.office.book.addName')}
        onInput={(event) => {
          name.value = event.currentTarget.value
        }}
      />
      <Button type="submit" size="small" disabled={isBusy.value}>
        {tr('ui.office.book.addName')}
      </Button>
    </form>
  )
}

interface AddForm {
  readonly name: Signal<string>
  readonly isBusy: Signal<boolean>
  readonly failure: Signal<string | undefined>
}

function submitName({ name, isBusy, failure }: AddForm): void {
  const typed = name.value.trim()

  if (typed === '' || isBusy.value) {
    return
  }

  isBusy.value = true
  failure.value = undefined
  addWatch(typed)
    .then((refusal) => {
      failure.value = refusal

      if (refusal === undefined) {
        name.value = ''
      }
    })
    .catch((error: unknown) => {
      failure.value = toErrorText(error)
    })
    .finally(() => {
      isBusy.value = false
    })
}

// Alerts you set that still stand or have fired; the plan's own stop and target alerts are the
// daemon's to re-arm, and a deleted one is gone from the list.
function AlertList({ alerts }: { readonly alerts: readonly AlertWire[] }) {
  const mine = alerts.filter((alert) => alert.source === 'you' && alert.state !== 'disabled')

  if (mine.length === 0) {
    return <p class="meta">{tr('ui.office.book.alertsEmpty')}</p>
  }

  return (
    <div class="row-list">
      {mine.map((alert) => (
        <AlertRow key={alert.id} alert={alert} withTicker />
      ))}
    </div>
  )
}
