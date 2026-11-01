import { useEffect } from 'preact/hooks'

import type { LedgerPreviewResponse } from '@/app/server/wire/money'
import type { LedgerDraft } from '@/web/state/trade'
import { formatDay } from '@/i18n'
import { ApiFailure } from '@/web/api/client'
import { holdingsBlock } from '@/web/state/market'
import { locale } from '@/web/state/session'
import { previewLedger } from '@/web/state/trade'
import { formatFieldFigure } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { TextField } from '@/web/ui/dialogs/trade-fields'
import { currencyOf } from '@/web/ui/dialogs/trade-kinds'
import { buildPreviewDraft, type TradeForm } from '@/web/ui/dialogs/trade-state'
import { Button } from '@/web/ui/kit/button'

// The ask waits for typing to pause, so a figure typed digit by digit asks once.
const PREVIEW_DELAY_MS = 400
const INCOMPLETE = 'incomplete'
// A row in the book's currency, or one that moves no money, takes no rate.
const NO_RATE = 'no-rate'

/** Asks the daemon whether the row takes a rate whenever the draft settles in a currency other than
 *  the book's; the rate field shows only when it answers one. A newer draft cancels the ask before
 *  it, and closing the dialog cancels the last. */
export function useFxPreview(form: TradeForm): void {
  const draft = buildPreviewDraft(form)
  const print = previewKeyOf(draft, holdingsBlock.view.value.data?.baseCurrency)
  const retry = form.fxRetry.value

  useEffect(() => {
    // An incomplete draft keeps the last answer and is refused on save as it stands.
    if (draft === undefined) {
      form.fxStatus.value = 'idle'
      return undefined
    }

    if (print === NO_RATE) {
      applyRate(form, undefined)
      return undefined
    }

    const controller = new AbortController()
    const timer = setTimeout(() => askRate(form, draft, controller.signal), PREVIEW_DELAY_MS)

    form.fxStatus.value = 'pending'

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [print, retry])
}

function previewKeyOf(draft: LedgerDraft | undefined, base: string | undefined): string {
  if (draft === undefined) {
    return INCOMPLETE
  }

  const currency = currencyOf(draft)

  return currency === undefined || currency === base ? NO_RATE : JSON.stringify(draft)
}

function askRate(form: TradeForm, draft: LedgerDraft, signal: AbortSignal): void {
  const replacing = form.start.entry?.id

  previewLedger({ draft, ...(replacing === undefined ? {} : { replacing }) }, signal).then(
    (answer) => {
      if (!signal.aborted) {
        applyRate(form, answer.fxRate)
      }
    },
    (error: unknown) => {
      if (signal.aborted) {
        return
      }

      // A draft the book refuses takes no rate; the save shows the daemon's own sentence.
      if (error instanceof ApiFailure && error.code === 'invalid_body') {
        applyRate(form, undefined)
        return
      }

      form.fxStatus.value = 'failed'
    }
  )
}

// The field keeps a rate the operator typed; one still showing the last market rate follows the
// new one.
function applyRate(form: TradeForm, fxRate: LedgerPreviewResponse['fxRate']): void {
  const shown = form.fxRate.value
  const typed = form.rate.value.trim()
  const isUntouched =
    typed === '' || (shown !== undefined && typed === formatFieldFigure(shown.rate))

  if (fxRate !== undefined && isUntouched) {
    form.rate.value = formatFieldFigure(fxRate.rate)
  }

  form.fxRate.value = fxRate
  form.fxStatus.value = 'idle'
}

/** Tỷ giá, required where the daemon asked for one, prefilled with the day's market rate. */
export function RateField({ form }: { readonly form: TradeForm }) {
  const fxRate = form.fxRate.value

  if (fxRate === undefined) {
    return null
  }

  return (
    <TextField
      form={form}
      id="trade-rate"
      label={tr('trading.render.ledger.label.operatorFxRate')}
      value={form.rate}
      paths={['operatorFxRate']}
      hint={tr('ui.office.trade.fxPrefill', { day: formatDay(locale.value, fxRate.day) })}
    />
  )
}

/** The day's rate could not be read: nothing saves until it is, and no rate is guessed. */
export function FxFailure({ form }: { readonly form: TradeForm }) {
  if (form.fxStatus.value !== 'failed') {
    return null
  }

  return (
    <div class="strip is-problem" role="alert">
      <span>{tr('ui.office.trade.fxPreviewFailed')}</span>
      <Button
        size="small"
        onClick={() => {
          form.fxRetry.value += 1
        }}
      >
        {tr('ui.office.common.retry')}
      </Button>
    </div>
  )
}
