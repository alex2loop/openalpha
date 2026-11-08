import { useEffect, useRef, useState } from 'preact/hooks'

import type { Locale, Translate } from '@/web/brief/strings'
import {
  keepPushLocale,
  type ReminderAnswer,
  readReminder,
  reminderSupport,
  subscribePush,
  unsubscribePush,
} from '@/web/brief/push'
import { Button } from '@/web/ui/kit/button'

interface ReminderProps {
  readonly t: Translate
  readonly locale: Locale
}

type ReminderState = ReminderAnswer | 'checking' | 'off' | 'turning-on' | 'turning-off'

/** The reminder in the footer: nothing where the phone cannot take one, a line telling a browser
 *  tab to install the app first, and otherwise the button that turns it on or off. */
export function Reminder({ t, locale }: ReminderProps) {
  switch (reminderSupport()) {
    case 'none':
      return null
    case 'install-first':
      return <p class="meta">{t('ui.brief.reminder.installFirst')}</p>
    case 'push':
      return <PushReminder t={t} locale={locale} />
  }
}

interface ReminderControl {
  readonly state: ReminderState
  readonly turnOn: () => void
  readonly turnOff: () => void
}

function PushReminder({ t, locale }: ReminderProps) {
  const { state, turnOn, turnOff } = useReminder(locale)

  if (state === 'checking') {
    return null
  }

  const isOn = state === 'on' || state === 'turning-off'

  return (
    <>
      <Line t={t} state={state} />
      <Button
        disabled={state === 'turning-on' || state === 'turning-off'}
        onClick={isOn ? turnOff : turnOn}
      >
        {isOn ? t('ui.brief.reminder.turnOff') : t('ui.brief.reminder.turnOn')}
      </Button>
    </>
  )
}

// Reads the phone once when the page opens; a tap turns the reminder on or off.
function useReminder(locale: Locale): ReminderControl {
  const [state, setState] = useState<ReminderState>('checking')
  const openLocale = useRef(locale)

  useEffect(() => {
    const controller = new AbortController()

    openReminder(openLocale.current).then((opened) => {
      if (!controller.signal.aborted) {
        setState(opened)
      }
    })

    return () => controller.abort()
  }, [])

  // The reminder follows the reader's language while it is on.
  useEffect(() => {
    if (state === 'on') {
      keepPushLocale(locale).catch(() => undefined)
    }
  }, [state, locale])

  const turnOn = () => {
    setState('turning-on')
    subscribePush(locale).then(setState, () => setState('failed'))
  }

  const turnOff = () => {
    setState('turning-off')
    unsubscribePush().then(
      () => setState('off'),
      () => setState('on')
    )
  }

  return { state, turnOn, turnOff }
}

// A phone that already has reminders on is told to the Worker again, which restores a dropped row
// and resets its failures; the reader sees the line only when the Worker has no room for it.
async function openReminder(locale: Locale): Promise<ReminderState> {
  try {
    if (!(await readReminder())) {
      return 'off'
    }

    const answer = await subscribePush(locale)

    return answer === 'on' || answer === 'full' ? answer : 'off'
  } catch {
    // A phone that cannot say reads as off; the button turns it on.
    return 'off'
  }
}

function Line({ t, state }: { readonly t: Translate; readonly state: ReminderState }) {
  switch (state) {
    case 'on':
    case 'turning-off':
      return <p class="meta">{t('ui.brief.reminder.on')}</p>
    case 'denied':
    case 'full':
    case 'failed':
      return (
        <p class="app-notice" role="alert">
          {t(`ui.brief.reminder.${state}`)}
        </p>
      )
    default:
      return null
  }
}
