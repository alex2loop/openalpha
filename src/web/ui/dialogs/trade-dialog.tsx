import type { TypedPrice } from '@/app/server/wire/vocab'
import { formatDay } from '@/i18n'
import { openBook } from '@/web/state/book'
import { locale } from '@/web/state/session'
import {
  deleteTrade,
  editTrade,
  recordTrade,
  type TradeDraft,
  type TradeEntry,
  toTradeDraft,
} from '@/web/state/trade'
import { tr } from '@/web/text/tr'
import { describeFailure } from '@/web/ui/dialogs/field-errors'
import { submitWithPriceConfirm } from '@/web/ui/dialogs/price-confirm'
import { PriceQuestion } from '@/web/ui/dialogs/price-question'
import { PRICE_FIELD_ID, TRADE_PATHS, TradeFields } from '@/web/ui/dialogs/trade-fields'
import {
  buildTradeDraft,
  createTradeForm,
  describeTrade,
  keyFor,
  newIdempotencyKey,
  snapshotTrade,
  type TradeForm,
  type TradeStart,
} from '@/web/ui/dialogs/trade-state'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { type ModalHandle, openModal } from '@/web/ui/kit/modal'
import { showUndo } from '@/web/ui/kit/undo-bar'

import './dialogs.css'

interface OpenTrade {
  readonly form: TradeForm
  readonly initial: string
  handle?: ModalHandle
}

/** "Ghi giao dịch": a buy or sell the operator made at the exchange, written into the ledger. It
 *  places no order. Given a row, the same dialog edits it. */
export function openTradeDialog(start: TradeStart = {}): void {
  const form = createTradeForm(start)
  const open: OpenTrade = { form, initial: snapshotTrade(form) }
  const { entry } = start

  open.handle = openModal({
    title:
      entry === undefined
        ? tr('ui.office.common.recordTrade')
        : tr('ui.office.trade.editTitle', {
            ticker: entry.instrument.ticker,
            day: formatDay(locale.value, entry.at),
          }),
    body: <TradeBody open={open} />,
    footer: <TradeFooter open={open} />,
    dirty: () => snapshotTrade(form) !== open.initial,
    wide: true,
  })
}

function TradeBody({ open }: { readonly open: OpenTrade }) {
  const { form } = open
  const { failure, question } = form
  const preview = describeTrade(form)

  return (
    <div class="dialog-form">
      {failure.value?.top !== undefined && (
        <p class="failure-line" role="alert">
          {failure.value.top}
        </p>
      )}
      <TradeFields form={form} />
      {preview !== undefined && <p class="meta">{preview}</p>}
      {question.value !== undefined && (
        <PriceQuestion
          question={question.value}
          isBusy={form.isBusy.value}
          onConfirm={() => confirm(open)}
          onEdit={() => editPrice(form)}
        />
      )}
    </div>
  )
}

function TradeFooter({ open }: { readonly open: OpenTrade }) {
  const { form } = open
  const { entry } = form.start

  return (
    <>
      <div class="dialog-foot-left">
        {entry !== undefined && (
          <Button kind="destructive" onClick={() => askDelete(entry)}>
            {tr('trading.render.affordance.deleteRow')}
          </Button>
        )}
        <span class="dialog-note">
          {tr(entry === undefined ? 'ui.office.trade.note' : 'ui.office.trade.editNote')}
        </span>
      </div>
      <Button onClick={() => open.handle?.close()}>{tr('ui.office.common.cancel')}</Button>
      <Button
        kind="commit"
        disabled={form.isBusy.value || form.venue.value === '' || form.question.value !== undefined}
        onClick={() => submit(open)}
      >
        {tr(entry === undefined ? 'ui.office.trade.save' : 'ui.office.trade.saveEdit')}
      </Button>
    </>
  )
}

function editPrice(form: TradeForm): void {
  form.question.value = undefined
  document.getElementById(PRICE_FIELD_ID)?.focus()
}

interface Attempt {
  readonly draft: TradeDraft
  readonly typedPrice: TypedPrice
  readonly key: string
}

// `unconfirmed` lets the daemon compare the price with the market; a price it doubts comes back as
// a question, and only the operator's yes sends the same draft as `confirmed`.
function submit(open: OpenTrade): void {
  begin(open, (draft, key) =>
    submitWithPriceConfirm(
      (typedPrice) => write(open.form, { draft, typedPrice, key }),
      (question) => {
        open.form.question.value = question
      }
    )
  )
}

function confirm(open: OpenTrade): void {
  begin(open, (draft, key) => write(open.form, { draft, typedPrice: 'confirmed', key }))
}

function begin(open: OpenTrade, send: (draft: TradeDraft, key: string) => Promise<unknown>): void {
  const { form } = open
  const build = buildTradeDraft(form)

  if (build.kind === 'invalid') {
    form.refused.value = build.refused
    return
  }

  form.isBusy.value = true
  form.failure.value = undefined
  form.refused.value = new Map()
  form.question.value = undefined
  send(build.draft, keyFor(form, build.draft))
    .then((saved) => {
      if (saved !== undefined) {
        open.handle?.close()
        openBook('history')
      }
    })
    .catch((error: unknown) => {
      form.failure.value = describeFailure(error, TRADE_PATHS)
    })
    .finally(() => {
      form.isBusy.value = false
    })
}

function write(form: TradeForm, attempt: Attempt): Promise<unknown> {
  const { draft, typedPrice, key } = attempt
  const { entry } = form.start

  return entry === undefined
    ? recordTrade({ draft, typedPrice }, key)
    : editTrade(entry.id, { draft, typedPrice })
}

function askDelete(entry: TradeEntry): void {
  const words = {
    side: tr(`trading.ledger.kind.${entry.kind}`),
    ticker: entry.instrument.ticker,
    day: formatDay(locale.value, entry.at),
  }

  askConfirm({
    title: tr('ui.office.trade.deleteAsk', words),
    lines: [tr('ui.office.trade.deleteBody')],
    confirmLabel: tr('trading.render.affordance.deleteRow'),
    isDestructive: true,
    keepLabel: tr('ui.office.trade.keep'),
    confirm: async () => {
      await deleteTrade(entry.id)
      showUndo(tr('ui.office.book.undoTrade', words), () => restoreTrade(entry))
    },
  })
}

// The operator recorded this row once, so its price is theirs to stand by.
async function restoreTrade(entry: TradeEntry): Promise<undefined> {
  await recordTrade({ draft: toTradeDraft(entry), typedPrice: 'confirmed' }, newIdempotencyKey())
}
