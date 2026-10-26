import { type Signal, signal } from '@preact/signals'

import type { Rect } from '@/web/scene/types'
import { pluralKey } from '@/i18n'
import { callMeeting, clearMeeting, MEET_FLOOR, meetingBar } from '@/web/scene/overlay/meeting'
import { tagTextOf } from '@/web/scene/overlay/name-tags'
import { view } from '@/web/scene/view'
import { joinInline, joinList } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { type ModalHandle, openModal } from '@/web/ui/kit/modal'

import './meeting-bar.css'

// One word of capitals, digits and the marks a market prefix or a class uses.
const TICKER_SHAPE = /^[A-Z0-9][A-Z0-9.:-]{0,15}$/

interface TickerAsk {
  readonly text: Signal<string>
  readonly message: Signal<string | undefined>
  handle?: ModalHandle
}

/** The meeting bar over the office floor: who is picked (or how to pick), the last meeting's note,
 *  "Gọi họp" and "Bỏ chọn"; and the box a Shift-drag draws. */
export function MeetingBar() {
  const { picks, isHinted, note, box } = meetingBar.value
  const isShown =
    view.value.floor === MEET_FLOOR && (picks.length > 0 || isHinted || note !== undefined)
  const names = joinList(picks.map((actor) => tagTextOf(actor, false)))
  const lead =
    picks.length > 0
      ? tr(pluralKey(picks.length, 'ui.office.meet.pickedOne', 'ui.office.meet.picked'), {
          count: picks.length,
          names,
        })
      : tr('ui.office.meet.hint')

  return (
    <>
      {box !== undefined && <PickBox rect={box} />}
      {isShown && (
        <div class="meeting-bar glass">
          <output class="meeting-bar-text">
            {joinInline(note === undefined ? [lead] : [lead, note])}
          </output>
          <Button kind="commit" size="small" disabled={picks.length === 0} onClick={askTicker}>
            {tr('ui.office.meet.call')}
          </Button>
          <Button size="small" onClick={clearMeeting}>
            {tr('ui.office.meet.clear')}
          </Button>
        </div>
      )}
    </>
  )
}

function PickBox({ rect }: { readonly rect: Rect }) {
  return (
    <div
      class="meeting-box"
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.w}px`,
        height: `${rect.h}px`,
      }}
    />
  )
}

// The ticker the meeting is about; the command goes into the input, never sent from here.
function askTicker(): void {
  const ask: TickerAsk = { text: signal(''), message: signal(undefined) }

  ask.handle = openModal({
    title: tr('ui.office.meet.call'),
    body: <TickerBody ask={ask} />,
    footer: (
      <>
        <Button onClick={() => ask.handle?.close()}>{tr('ui.office.common.cancel')}</Button>
        <Button kind="commit" onClick={() => submit(ask)}>
          {tr('ui.office.meet.call')}
        </Button>
      </>
    ),
    dirty: () => ask.text.value.trim() !== '',
  })
}

function TickerBody({ ask }: { readonly ask: TickerAsk }) {
  return (
    <div class="dialog-form">
      <label class="form-field form-label">
        {tr('ui.office.meet.ask')}
        <input
          type="text"
          class="mono"
          value={ask.text.value}
          autocapitalize="characters"
          onInput={(event) => {
            ask.text.value = event.currentTarget.value
            ask.message.value = undefined
          }}
        />
      </label>
      {ask.message.value !== undefined && (
        <p class="failure-line" role="alert">
          {ask.message.value}
        </p>
      )}
    </div>
  )
}

function submit(ask: TickerAsk): void {
  const ticker = ask.text.value.trim().toUpperCase()

  if (!TICKER_SHAPE.test(ticker)) {
    ask.message.value = tr('ui.office.common.needTicker')
    return
  }

  ask.handle?.close()
  callMeeting(ticker)
}
