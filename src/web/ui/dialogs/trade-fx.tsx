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
import { toPreviewRefusal } from '@/web/ui/dialogs/trade-refusal'
import { buildPreviewDraft, type TradeForm } from '@/web/ui/dialogs/trade-state'
import { Button } from '@/web/ui/kit/button'

// The ask waits for typing to pause, so a figure typed digit by digit asks once.
const PREVIEW_DELAY_MS = 400
const INCOMPLETE = 'incomplete'

/** Asks the daemon about every complete draft: whether the book would refuse it, and, when the draft
 *  settles in a currency other than the book's, whether the row takes a rate. The rate field shows
 *  only when it answers one, and only a row that may take one waits on the answer to save. A newer
 *  draft cancels the ask before it, and closing the dialog cancels the last. */
export function useFxPreview(form: TradeForm): void {
  const draft = buildPreviewDraft(form)
  const print = draft === undefined ? INCOMPLETE : JSON.stringify(draft)
  const isRated = draft !== undefined && isRateCurrency(draft)
  const retry = form.fxRetry.value

  useEffect(() => {
    // An incomplete draft keeps the last rate answer and is refused on save as it stands.
    if (draft === undefined) {
      form.fxStatus.value = 'idle'
      form.refusal.value = undefined
      return undefined
    }

    const controller = new AbortController()
    const timer = setTimeout(
      () => askPreview(form, { draft, isRated, signal: controller.signal }),
      PREVIEW_DELAY_MS
    )

    form.fxStatus.value = isRated ? 'pending' : 'idle'

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [print, isRated, retry])
}

// A row in the book's currency, or one that moves no money, takes no rate.
function isRateCurrency(draft: LedgerDraft): boolean {
  const currency = currencyOf(draft)

  return currency !== undefined && currency !== holdingsBlock.view.value.data?.baseCurrency
}

function askPreview(
  form: TradeForm,
  ask: { readonly draft: LedgerDraft; readonly isRated: boolean; readonly signal: AbortSignal }
): void {
  const { draft, isRated, signal } = ask
  const replacing = form.start.entry?.id

  previewLedger({ draft, ...(replacing === undefined ? {} : { replacing }) }, signal).then(
    (answer) => {
      if (!signal.aborted) {
        form.refusal.value = undefined
        applyRate(form, answer.fxRate)
      }
    },
    (error: unknown) => {
      if (signal.aborted) {
        return
      }

      // A draft the book refuses takes no rate; the refusal shows under the preview, and the save
      // asks the daemon again.
      if (error instanceof ApiFailure && error.code === 'invalid_body') {
        form.refusal.value = toPreviewRefusal(draft, error)
        applyRate(form, undefined)
        return
      }

      // A rated row cannot save without its answer; any other row never needed one.
      if (isRated) {
        form.fxStatus.value = 'failed'
        return
      }

      applyRate(form, undefined)
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
