import type { LedgerEntryWire } from '@/app/server/wire/money'
import type { TypedPrice } from '@/app/server/wire/vocab'
import { formatDay } from '@/i18n'
import { openBook } from '@/web/state/book'
import { locale } from '@/web/state/session'
import {
  deleteTrade,
  editTrade,
  type LedgerDraft,
  previewLedger,
  recordTrade,
} from '@/web/state/trade'
import { tr } from '@/web/text/tr'
import { describeFailure } from '@/web/ui/dialogs/field-errors'
import { OtherFields } from '@/web/ui/dialogs/other-fields'
import { submitWithPriceConfirm } from '@/web/ui/dialogs/price-confirm'
import { PriceQuestion } from '@/web/ui/dialogs/price-question'
import {
  KindRow,
  PRICE_FIELD_ID,
  PricedFields,
  shownPaths,
  useVenues,
} from '@/web/ui/dialogs/trade-fields'
import { FxFailure, RateField, useFxPreview } from '@/web/ui/dialogs/trade-fx'
import {
  bookedRate,
  shapeOf,
  subjectOf,
  toLedgerDraft,
  withStatedRate,
} from '@/web/ui/dialogs/trade-kinds'
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

/** "Ghi giao dịch": a trade, dividend, share change or cash move the operator made, written into
 *  the ledger. It places no order. Given a row, the same dialog edits it. */
export function openTradeDialog(start: TradeStart = {}): void {
  const form = createTradeForm(start)
  const open: OpenTrade = { form, initial: snapshotTrade(form) }
  const { entry } = start

  open.handle = openModal({
    title:
      entry === undefined
        ? tr('ui.office.common.recordTrade')
        : tr('ui.office.trade.editTitle', {
            ticker: subjectOf(entry),
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

  useVenues(form)
  useFxPreview(form)

  return (
    <div class="dialog-form">
      {failure.value?.top !== undefined && (
        <p class="failure-line" role="alert">
          {failure.value.top}
        </p>
      )}
      <KindRow form={form} />
      {shapeOf(form.kind.value) === 'priced' ? (
        <PricedFields form={form} />
      ) : (
        <OtherFields form={form} />
      )}
      <RateField form={form} />
      <FxFailure form={form} />
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
      <Button kind="commit" disabled={!canSave(form)} onClick={() => submit(open)}>
        {tr(entry === undefined ? 'ui.office.trade.save' : 'ui.office.trade.saveEdit')}
      </Button>
    </>
  )
}

// A rate still being asked for, or one that could not be read, holds the save.
function canSave(form: TradeForm): boolean {
  const venues = form.kind.value === 'transfer' ? [form.venue, form.fromVenue] : [form.venue]

  return (
    !form.isBusy.value &&
    form.question.value === undefined &&
    form.fxStatus.value === 'idle' &&
    venues.every((venue) => venue.value !== '')
  )
}

function editPrice(form: TradeForm): void {
  form.question.value = undefined
  document.getElementById(PRICE_FIELD_ID)?.focus()
}

interface Attempt {
  readonly draft: LedgerDraft
  readonly typedPrice?: TypedPrice
  readonly key: string
}

// `unconfirmed` lets the daemon compare a trade's price with the market; a price it doubts comes
// back as a question, and only the operator's yes sends the same draft as `confirmed`. A row with no
// price is sent as it stands.
function submit(open: OpenTrade): void {
  begin(open, (draft, key) =>
    shapeOf(draft.kind) === 'priced'
      ? submitWithPriceConfirm(
          (typedPrice) => write(open.form, { draft, typedPrice, key }),
          (question) => {
            open.form.question.value = question
          }
        )
      : write(open.form, { draft, key })
  )
}

function confirm(open: OpenTrade): void {
  begin(open, (draft, key) => write(open.form, { draft, typedPrice: 'confirmed', key }))
}

function begin(open: OpenTrade, send: (draft: LedgerDraft, key: string) => Promise<unknown>): void {
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
      form.failure.value = describeFailure(error, shownPaths(form))
    })
    .finally(() => {
      form.isBusy.value = false
    })
}

function write(form: TradeForm, attempt: Attempt): Promise<unknown> {
  const { draft, typedPrice, key } = attempt
  const { entry } = form.start
  const request = { draft, ...(typedPrice === undefined ? {} : { typedPrice }) }

  return entry === undefined ? recordTrade(request, key) : editTrade(entry.id, request)
}

function askDelete(entry: LedgerEntryWire): void {
  const words = {
    side: tr(`trading.ledger.kind.${entry.kind}`),
    ticker: subjectOf(entry),
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

      // One key per undo: a retry after a timeout must not record the row twice.
      const restoreKey = newIdempotencyKey()

      showUndo(tr('ui.office.book.undoTrade', words), {
        undo: () => restoreTrade(entry, restoreKey),
      })
    },
  })
}

// The operator recorded this row once, so its price is theirs to stand by. A row in another
// currency states its booked rate again only where the daemon still asks for one.
async function restoreTrade(entry: LedgerEntryWire, key: string): Promise<undefined> {
  const draft = toLedgerDraft(entry)
  const rate = bookedRate(entry)
  const preview =
    rate === undefined ? {} : await previewLedger({ draft }, new AbortController().signal)
  const stated = withStatedRate(draft, preview.fxRate === undefined ? undefined : rate)

  await recordTrade(
    { draft: stated, ...(shapeOf(draft.kind) === 'priced' ? { typedPrice: 'confirmed' } : {}) },
    key
  )
}
