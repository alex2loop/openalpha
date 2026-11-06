import type { ComponentChildren, RefObject, TargetedPointerEvent } from 'preact'
import { type ReadonlySignal, useComputed } from '@preact/signals'
import { useEffect, useId, useRef } from 'preact/hooks'

import { type GlossaryTermId, glossaryEntry, glossaryGroup, groupOfHeading } from '@/i18n'
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

// The word whose card a resting mouse opened and nothing pinned; another word's rest replaces it.
let hoverOpenedId: string | undefined

interface PointerHandlers {
  readonly onPointerEnter: (event: TargetedPointerEvent<HTMLElement>) => void
  readonly onPointerLeave: (event: TargetedPointerEvent<HTMLElement>) => void
}

interface Disclosure {
  readonly id: string
  readonly anchor: RefObject<HTMLButtonElement | null>
  /** A signal, so opening or closing a card updates its button without rendering every word. */
  readonly expanded: ReadonlySignal<'true' | 'false'>
  readonly trigger: PointerHandlers & { readonly onClick: () => void }
  /** On the card, so a mouse that crosses onto it does not close it. */
  readonly hold: PointerHandlers
}

interface CardText {
  readonly name: string
  readonly text: string
}

interface TermProps {
  readonly id: GlossaryTermId
  readonly children: ComponentChildren
}

/** A word a beginner may not know, with a dotted underline. A real button: Tab reaches it, and
 *  Enter, a click or a tap opens its card; a mouse resting on it opens the card too. */
export function Term({ id, children }: TermProps) {
  const textOf = (): CardText => {
    const { name, definition } = glossaryEntry(locale.value, id)

    return { name, text: definition }
  }

  return (
    <Trigger class="term" textOf={textOf}>
      {children}
    </Trigger>
  )
}

/** The small "?" after a heading that has a group definition, saying what the group covers;
 *  nothing after a heading that has none. */
export function GroupHelp({ heading }: { readonly heading: string }) {
  const group = groupOfHeading(heading)

  if (group === undefined) {
    return null
  }

  const textOf = (): CardText => {
    const { title, about } = glossaryGroup(locale.value, group)

    return { name: title, text: about }
  }

  return (
    <Trigger
      class="term-help"
      label={tr('ui.office.glossary.about', { name: textOf().name })}
      textOf={textOf}
    >
      <HelpIcon />
    </Trigger>
  )
}

interface TriggerProps {
  readonly class: string
  /** The button's own name, where its content (an icon) has none. */
  readonly label?: string
  readonly textOf: () => CardText
  readonly children: ComponentChildren
}

function Trigger({ class: className, label, textOf, children }: TriggerProps) {
  const disclosure = useDisclosure()

  return (
    <>
      <button
        ref={disclosure.anchor}
        type="button"
        class={className}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={disclosure.expanded}
        {...disclosure.trigger}
      >
        {children}
      </button>
      <TermPopover disclosure={disclosure} textOf={textOf} />
    </>
  )
}

interface TermPopoverProps {
  readonly disclosure: Disclosure
  readonly textOf: () => CardText
}

function TermPopover({ disclosure, textOf }: TermPopoverProps) {
  const { name, text } = textOf()

  return (
    <Popover id={disclosure.id} anchor={disclosure.anchor} label={name} near>
      <TermCard name={name} text={text} hold={disclosure.hold} />
    </Popover>
  )
}

function TermCard({ name, text, hold }: CardText & { readonly hold: PointerHandlers }) {
  return (
    <div class="term-card" {...hold}>
      <h2 class="term-name">{name}</h2>
      <p class="term-text">{text}</p>
      <Button kind="tertiary" size="small" onClick={openGlossary}>
        {tr('ui.office.glossary.seeAll')}
      </Button>
    </div>
  )
}

// A card a mouse opened closes when the mouse leaves; one a click, a tap or a key opened is
// pinned and closes the way every popover does. The pending timer ends with the word.
function useDisclosure(): Disclosure {
  const id = useId()
  const anchor = useRef<HTMLButtonElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const isPinned = useRef(false)
  const expanded = useComputed(() => (openPopoverId.value === id ? 'true' : 'false'))

  useEffect(
    () => () => {
      clearTimeout(timer.current)

      if (openPopoverId.peek() === id) {
        closePopover()
      }
    },
    [id]
  )

  return { id, anchor, expanded, ...toHandlers({ id, timer, isPinned }) }
}

interface HandlerState {
  readonly id: string
  readonly timer: { current: ReturnType<typeof setTimeout> | undefined }
  readonly isPinned: { current: boolean }
}

function toHandlers({ id, timer, isPinned }: HandlerState): Pick<Disclosure, 'trigger' | 'hold'> {
  const isOpen = () => openPopoverId.peek() === id
  // A passive hover never replaces a popover someone opened (the bell, the jobs, a pinned word),
  // only another word's hover card, which the mouse has left or is about to.
  const openByHover = () => {
    const open = openPopoverId.peek()

    if (open === undefined || open === hoverOpenedId) {
      isPinned.current = false
      hoverOpenedId = id
      openPopover(id)
    }
  }
  // Another word may have opened since the mouse left, and its card is not this one's to close.
  const closeByHover = () => {
    if (isOpen()) {
      closePopover()
    }
  }
  const enter = (event: TargetedPointerEvent<HTMLElement>) => {
    clearTimeout(timer.current)

    if (event.pointerType === MOUSE_POINTER && !isOpen()) {
      timer.current = setTimeout(openByHover, HOVER_OPEN_MS)
    }
  }
  const leave = (event: TargetedPointerEvent<HTMLElement>) => {
    clearTimeout(timer.current)

    if (event.pointerType === MOUSE_POINTER && isOpen() && !isPinned.current) {
      timer.current = setTimeout(closeByHover, HOVER_CLOSE_MS)
    }
  }
  const toggle = () => {
    clearTimeout(timer.current)

    if (isOpen() && isPinned.current) {
      closePopover()

      return
    }

    isPinned.current = true
    hoverOpenedId = undefined
    openPopover(id)
  }

  return {
    trigger: { onClick: toggle, onPointerEnter: enter, onPointerLeave: leave },
    hold: { onPointerEnter: enter, onPointerLeave: leave },
  }
}
