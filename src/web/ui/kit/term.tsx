import type { ComponentChildren, RefObject, TargetedPointerEvent } from 'preact'
import { useEffect, useId, useRef } from 'preact/hooks'

import {
  type GlossaryGroup,
  type GlossaryTermId,
  glossaryEntry,
  glossaryGroup,
  groupOfHeading,
} from '@/i18n'
import { locale } from '@/web/state/session'
import { tr } from '@/web/text/tr'
import { openGlossary } from '@/web/ui/glossary/glossary-dialog'
import { Button } from '@/web/ui/kit/button'
import { HelpIcon } from '@/web/ui/kit/icons'
import { closePopover, openPopover, openPopoverId, Popover } from '@/web/ui/kit/popover'

import './term.css'

/** A mouse that rests on a word opens its card after this, so sweeping across a grid opens none. */
const HOVER_OPEN_MS = 250
/** The card stays this long once the mouse leaves, which is time to cross the gap onto it. */
const HOVER_CLOSE_MS = 250
const MOUSE_POINTER = 'mouse'

interface TermProps {
  readonly id: GlossaryTermId
  readonly children: ComponentChildren
}

/** A word a beginner may not know, with a dotted underline. A real button: Tab reaches it, and
 *  Enter, a click or a tap opens its card; a mouse resting on it opens the card too. */
export function Term({ id, children }: TermProps) {
  const disclosure = useDisclosure()
  const entry = glossaryEntry(locale.value, id)

  return (
    <>
      <button
        ref={disclosure.anchor}
        type="button"
        class="term"
        aria-haspopup="dialog"
        aria-expanded={disclosure.isOpen}
        {...disclosure.trigger}
      >
        {children}
      </button>
      <Popover id={disclosure.id} anchor={disclosure.anchor} label={entry.name} near>
        <TermCard name={entry.name} text={entry.definition} hold={disclosure.hold} />
      </Popover>
    </>
  )
}

/** The small "?" after a heading that has a group definition, saying what the group covers;
 *  nothing after a heading that has none. */
export function GroupHelp({ heading }: { readonly heading: string }) {
  const group = groupOfHeading(heading)

  return group === undefined ? null : <GroupHelpButton group={group} />
}

function GroupHelpButton({ group }: { readonly group: GlossaryGroup }) {
  const disclosure = useDisclosure()
  const entry = glossaryGroup(locale.value, group)

  return (
    <>
      <button
        ref={disclosure.anchor}
        type="button"
        class="term-help"
        aria-label={tr('ui.office.glossary.about', { name: entry.title })}
        aria-haspopup="dialog"
        aria-expanded={disclosure.isOpen}
        {...disclosure.trigger}
      >
        <HelpIcon />
      </button>
      <Popover id={disclosure.id} anchor={disclosure.anchor} label={entry.title} near>
        <TermCard name={entry.title} text={entry.about} hold={disclosure.hold} />
      </Popover>
    </>
  )
}

interface PointerHandlers {
  readonly onPointerEnter: (event: TargetedPointerEvent<HTMLElement>) => void
  readonly onPointerLeave: (event: TargetedPointerEvent<HTMLElement>) => void
}

interface Disclosure {
  readonly id: string
  readonly anchor: RefObject<HTMLButtonElement | null>
  readonly isOpen: boolean
  readonly trigger: PointerHandlers & { readonly onClick: () => void }
  /** On the card, so a mouse that crosses onto it does not close it. */
  readonly hold: PointerHandlers
}

// A card a mouse opened closes when the mouse leaves; one a click, a tap or a key opened is
// pinned and closes the way every popover does. The pending timer ends with the word.
function useDisclosure(): Disclosure {
  const id = useId()
  const anchor = useRef<HTMLButtonElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const isPinned = useRef(false)

  useEffect(
    () => () => {
      clearTimeout(timer.current)

      if (openPopoverId.peek() === id) {
        closePopover()
      }
    },
    [id]
  )

  return {
    id,
    anchor,
    isOpen: openPopoverId.value === id,
    ...toHandlers({ id, timer, isPinned }),
  }
}

interface HandlerState {
  readonly id: string
  readonly timer: { current: ReturnType<typeof setTimeout> | undefined }
  readonly isPinned: { current: boolean }
}

function toHandlers({ id, timer, isPinned }: HandlerState): Pick<Disclosure, 'trigger' | 'hold'> {
  const isOpen = () => openPopoverId.peek() === id
  const wait = (ms: number, action: () => void) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(action, ms)
  }
  const enter = (event: TargetedPointerEvent<HTMLElement>) => {
    clearTimeout(timer.current)

    if (event.pointerType === MOUSE_POINTER && !isOpen()) {
      wait(HOVER_OPEN_MS, () => {
        isPinned.current = false
        openPopover(id)
      })
    }
  }
  const leave = (event: TargetedPointerEvent<HTMLElement>) => {
    clearTimeout(timer.current)

    if (event.pointerType === MOUSE_POINTER && isOpen() && !isPinned.current) {
      wait(HOVER_CLOSE_MS, closePopover)
    }
  }
  const toggle = () => {
    clearTimeout(timer.current)

    if (isOpen() && isPinned.current) {
      closePopover()

      return
    }

    isPinned.current = true
    openPopover(id)
  }

  return {
    trigger: { onClick: toggle, onPointerEnter: enter, onPointerLeave: leave },
    hold: { onPointerEnter: enter, onPointerLeave: leave },
  }
}

interface TermCardProps {
  readonly name: string
  readonly text: string
  readonly hold: PointerHandlers
}

function TermCard({ name, text, hold }: TermCardProps) {
  return (
    <div class="term-card" {...hold}>
      <h2 class="term-name">{name}</h2>
      <p class="term-text">{text}</p>
      <Button kind="tertiary" size="small" onClick={() => openGlossary()}>
        {tr('ui.office.glossary.seeAll')}
      </Button>
    </div>
  )
}
