import { type Signal, signal } from '@preact/signals'

import { keyOf, watchedNames } from '@/web/state/market'
import { addWatch, qualifyName } from '@/web/state/watch'
import { toErrorText, tr } from '@/web/text/tr'
import { type Match, useTickerMatches } from '@/web/ui/command/ticker-matches'
import { FieldNote } from '@/web/ui/dialogs/field-note'
import { Button } from '@/web/ui/kit/button'
import { type ModalHandle, openModal } from '@/web/ui/kit/modal'

import './dialogs.css'

interface WatchRequest {
  /** Leads back to where the dialog was opened from. */
  readonly onBack?: () => void
}

interface OpenWatch {
  readonly request: WatchRequest
  readonly text: Signal<string>
  readonly picked: Signal<Match | undefined>
  readonly message: Signal<string | undefined>
  readonly isBusy: Signal<boolean>
  handle?: ModalHandle
}

/** "Thêm mã vào danh sách theo dõi": type a ticker and pick it from what the daemon finds. */
export function openWatchAddDialog(request: WatchRequest = {}): void {
  const open: OpenWatch = {
    request,
    text: signal(''),
    picked: signal(undefined),
    message: signal(undefined),
    isBusy: signal(false),
  }

  open.handle = openModal({
    title: tr('ui.office.watch.title'),
    body: <WatchBody open={open} />,
    footer: <WatchFooter open={open} />,
    dirty: () => open.text.value.trim() !== '',
  })
}

function WatchBody({ open }: { readonly open: OpenWatch }) {
  const { text, picked, message } = open
  const typed = text.value.trim()
  // A name already picked from the list needs no further search.
  const matches = useTickerMatches(typed === '' || picked.value !== undefined ? undefined : typed)

  return (
    <div class="dialog-form">
      <label class="form-field form-label">
        {tr('ui.office.common.ticker')}
        <input
          type="text"
          class="mono"
          value={text.value}
          placeholder={tr('ui.office.watch.placeholder')}
          onInput={(event) => {
            text.value = event.currentTarget.value
            picked.value = undefined
            message.value = undefined
          }}
        />
      </label>
      <FieldNote message={message.value} />
      {matches.length > 0 && (
        <div class="dialog-suggest">
          {matches.map((match) => (
            <button key={keyOf(match.instrument)} type="button" onClick={() => pick(open, match)}>
              <b>{match.instrument.ticker}</b>
              {match.name !== undefined && <span class="meta">{match.name}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function WatchFooter({ open }: { readonly open: OpenWatch }) {
  const { onBack } = open.request

  return (
    <>
      {onBack !== undefined && (
        <div class="dialog-foot-left">
          <Button onClick={onBack}>{tr('ui.office.settings.toSettings')}</Button>
        </div>
      )}
      <Button onClick={() => open.handle?.close()}>{tr('ui.office.common.cancel')}</Button>
      <Button kind="commit" disabled={open.isBusy.value} onClick={() => submit(open)}>
        {tr('ui.office.watch.add')}
      </Button>
    </>
  )
}

function pick(open: OpenWatch, match: Match): void {
  open.picked.value = match
  open.text.value = match.instrument.ticker
  open.message.value = undefined
}

// A name already on the list, or one the daemon cannot place, is told apart before anything is sent.
function submit(open: OpenWatch): void {
  const typed = open.text.value.trim().toUpperCase()
  const { picked } = open
  const held = watchedNames.value.some(
    (instrument) =>
      instrument.ticker === typed &&
      (picked.value === undefined || keyOf(instrument) === keyOf(picked.value.instrument))
  )

  if (typed === '') {
    open.message.value = tr('ui.office.common.needTicker')
    return
  }

  if (held) {
    open.message.value = tr('ui.office.watch.already', { ticker: typed })
    return
  }

  open.isBusy.value = true
  addWatch(picked.value === undefined ? typed : qualifyName(picked.value.instrument))
    .then((refusal) => {
      if (refusal === undefined) {
        open.handle?.close()
      } else {
        open.message.value = refusal
      }
    })
    .catch((error: unknown) => {
      open.message.value = toErrorText(error)
    })
    .finally(() => {
      open.isBusy.value = false
    })
}
