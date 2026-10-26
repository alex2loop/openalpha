import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import { sceneSpoken } from '@/web/scene/overlay/overlay'
import { urgentTextOf } from '@/web/state/attention'
import { onWireEvent } from '@/web/state/events'

import './a11y.css'

interface Spoken {
  readonly text: string
  readonly seq: number
}

/** The page's live regions: the scene's lines, said politely, and a new approval or a broken stop,
 *  said at once. Nothing else is announced from here. */
export function Announcer() {
  const urgent = useSignal<Spoken | undefined>(undefined)

  useEffect(() => {
    const say = (text: string | undefined): void => {
      if (text !== undefined) {
        urgent.value = { text, seq: (urgent.peek()?.seq ?? 0) + 1 }
      }
    }
    const offs = [
      onWireEvent('approval_requested', (event) => say(urgentTextOf(event))),
      onWireEvent('stop_breached', (event) => say(urgentTextOf(event))),
    ]

    return () => {
      for (const off of offs) {
        off()
      }
    }
  }, [urgent])

  return (
    <div class="sr">
      <p role="status" aria-live="polite">
        {sceneSpoken.value}
      </p>
      <div aria-live="assertive" aria-atomic="true">
        {urgent.value !== undefined && <p key={urgent.value.seq}>{urgent.value.text}</p>}
      </div>
    </div>
  )
}
