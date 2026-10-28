import { type Signal, signal } from '@preact/signals'

import type { AlertCreateBody, AlertWire } from '@/app/server/wire/market'
import type { TypedPrice } from '@/app/server/wire/vocab'
import { sendJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { alertsBlock, findQuote } from '@/web/state/market'
import { toDecimal } from '@/web/text/decimal'
import { formatMarketPrice, toWholeUnits } from '@/web/text/market-price'
import { tr } from '@/web/text/tr'
import { describeFailure, type FormFailure } from '@/web/ui/dialogs/field-errors'
import { FieldNote } from '@/web/ui/dialogs/field-note'
import { submitWithPriceConfirm } from '@/web/ui/dialogs/price-confirm'
import { PriceQuestion } from '@/web/ui/dialogs/price-question'
import { Button } from '@/web/ui/kit/button'
import { type ModalHandle, openModal } from '@/web/ui/kit/modal'
import { Segmented } from '@/web/ui/kit/segmented'

import './dialogs.css'

type Condition = AlertCreateBody['condition']

const CONDITIONS: readonly Condition[] = ['above', 'below']
const LEVEL_FIELD_ID = 'alert-level'
const SHOWN_PATHS = ['threshold']

interface AlertRequest {
  readonly ticker: string
  /** Left off where the chat link knows only the ticker; the daemon then finds its market. */
  readonly market?: string
}

interface OpenAlert {
  readonly request: AlertRequest
  readonly condition: Signal<Condition>
  readonly level: Signal<string>
  readonly levelNeeded: Signal<boolean>
  readonly question: Signal<string | undefined>
  readonly failure: Signal<FormFailure | undefined>
  readonly isBusy: Signal<boolean>
  handle?: ModalHandle
}

/** "Báo khi giá {ticker}...": one alert that reaches this page when the price crosses the level.
 *  It watches and tells; nothing is bought or sold. */
export function openAlertDialog(request: AlertRequest): void {
  const open: OpenAlert = {
    request,
    condition: signal('above'),
    level: signal(''),
    levelNeeded: signal(false),
    question: signal(undefined),
    failure: signal(undefined),
    isBusy: signal(false),
  }

  open.handle = openModal({
    title: tr('ui.office.alert.title', { ticker: request.ticker }),
    body: <AlertBody open={open} />,
    footer: <AlertFooter open={open} />,
    dirty: () => open.level.value.trim() !== '',
  })
}

function AlertBody({ open }: { readonly open: OpenAlert }) {
  const { request, question, failure } = open
  const quote = findQuote(request.ticker, request.market)

  return (
    <div class="dialog-form">
      {failure.value?.top !== undefined && (
        <p class="failure-line" role="alert">
          {failure.value.top}
        </p>
      )}
      <DirectionField open={open} />
      <LevelField open={open} />
      {quote !== undefined && (
        <p class="meta">
          {tr('ui.office.alert.now', {
            price: formatMarketPrice(quote.market, quote.last, quote.kind),
          })}
        </p>
      )}
      {question.value !== undefined && (
        <PriceQuestion
          question={question.value}
          isBusy={open.isBusy.value}
          onConfirm={() => confirm(open)}
          onEdit={() => editLevel(open)}
        />
      )}
    </div>
  )
}

function DirectionField({ open }: { readonly open: OpenAlert }) {
  return (
    <div class="form-field">
      <span class="form-label">{tr('ui.office.alert.direction')}</span>
      <Segmented
        label={tr('ui.office.alert.direction')}
        value={open.condition.value}
        options={CONDITIONS.map((value) => ({
          value,
          label: tr(`trading.alert.condition.${value}`),
        }))}
        onChange={(value) => {
          open.condition.value = value
          open.question.value = undefined
        }}
      />
    </div>
  )
}

function LevelField({ open }: { readonly open: OpenAlert }) {
  const { level, levelNeeded, failure } = open

  return (
    <div class="form-field">
      <label class="form-label" for={LEVEL_FIELD_ID}>
        {tr('ui.office.common.priceLevel')}
      </label>
      <input
        id={LEVEL_FIELD_ID}
        type="text"
        inputMode="decimal"
        class="form-number"
        value={level.value}
        onInput={(event) => {
          level.value = event.currentTarget.value
          levelNeeded.value = false
          open.question.value = undefined
        }}
      />
      <FieldNote
        message={
          levelNeeded.value
            ? tr('ui.office.schedule.levelNeeded')
            : failure.value?.fields.get('threshold')
        }
      />
    </div>
  )
}

function AlertFooter({ open }: { readonly open: OpenAlert }) {
  return (
    <>
      <Button onClick={() => open.handle?.close()}>{tr('ui.office.common.cancel')}</Button>
      <Button
        kind="commit"
        disabled={open.isBusy.value || open.question.value !== undefined}
        onClick={() => submit(open)}
      >
        {tr('ui.office.common.setAlert')}
      </Button>
    </>
  )
}

function editLevel(open: OpenAlert): void {
  open.question.value = undefined
  document.getElementById(LEVEL_FIELD_ID)?.focus()
}

// The level is typed on the board's scale, like every price on the page; the daemon takes whole units.
function resolveThreshold(request: AlertRequest, typed: string): number | undefined {
  const level = toDecimal(typed)
  const market = request.market ?? findQuote(request.ticker)?.market

  if (level === undefined || level <= 0) {
    return undefined
  }

  return market === undefined ? level : toWholeUnits(market, level)
}

function post(open: OpenAlert, threshold: number, typedPrice: TypedPrice): Promise<AlertWire> {
  const { ticker, market } = open.request
  const body: AlertCreateBody = {
    instrument: market === undefined ? { ticker } : { ticker, market },
    condition: open.condition.value,
    threshold,
    typedPrice,
  }

  return sendJson('POST', ROUTES.alertCreate, { body })
}

// `unconfirmed` asks the daemon to check the level against the market; a level it doubts comes
// back as a question, and only the operator's yes sends `confirmed`.
function submit(open: OpenAlert): void {
  begin(open, (threshold) =>
    submitWithPriceConfirm(
      (typed) => post(open, threshold, typed),
      (question) => {
        open.question.value = question
      }
    )
  )
}

function confirm(open: OpenAlert): void {
  begin(open, (threshold) => post(open, threshold, 'confirmed'))
}

function begin(open: OpenAlert, send: (threshold: number) => Promise<AlertWire | undefined>): void {
  const threshold = resolveThreshold(open.request, open.level.value)

  if (threshold === undefined) {
    open.levelNeeded.value = true
    return
  }

  open.isBusy.value = true
  open.failure.value = undefined
  open.question.value = undefined
  send(threshold)
    .then((created) => {
      if (created !== undefined) {
        alertsBlock.retry()
        open.handle?.close()
      }
    })
    .catch((error: unknown) => {
      open.failure.value = describeFailure(error, SHOWN_PATHS)
    })
    .finally(() => {
      open.isBusy.value = false
    })
}
