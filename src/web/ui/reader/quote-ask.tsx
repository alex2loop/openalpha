import type { RefObject } from 'preact'
import { type Signal, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

const QUOTE_MIN_CHARS = 12
const QUOTE_MAX_CHARS = 220
const ELLIPSIS = '...'
const BUTTON_HEIGHT_PX = 34
const BUTTON_HALF_WIDTH_PX = 100
const BUTTON_GAP_PX = 8
const VIEWPORT_GUTTER_PX = 8
const CITATION_MARK = /\[\d+\]/g
const WHITESPACE = /\s+/g

interface QuoteAskProps {
  /** The scrolling column that holds the report. */
  readonly scroller: RefObject<HTMLElement | null>
  /** Gets the passage, citation marks stripped and cut short. */
  readonly onAsk: (quote: string) => void
}

interface Pick {
  readonly quote: string
  readonly left: number
  readonly top: number
}

/** "Hỏi về đoạn này": floats by a selected passage. It leaves when the selection changes, the page
 *  scrolls or the window resizes, and it only hands the passage on: nothing is sent. */
export function QuoteAsk({ scroller, onAsk }: QuoteAskProps) {
  const pick = useSignal<Pick | undefined>(undefined)

  useEffect(() => armSelection(scroller.current, pick), [])

  const picked = pick.value

  if (picked === undefined) {
    return null
  }

  return (
    // The press must not collapse the selection it quotes.
    <div
      class="quote-ask solid-pop"
      style={`left:${picked.left}px;top:${picked.top}px`}
      onPointerDown={(event) => event.preventDefault()}
    >
      <Button
        size="small"
        onClick={() => {
          pick.value = undefined
          onAsk(picked.quote)
        }}
      >
        {tr('ui.office.reader.ask')}
      </Button>
    </div>
  )
}

function armSelection(column: HTMLElement | null, pick: Signal<Pick | undefined>): () => void {
  const listeners = new AbortController()
  const { signal } = listeners
  const hide = (): void => {
    pick.value = undefined
  }
  const show = (): void => {
    pick.value = readSelection(column)
  }

  // A selection that still quotes the same words stays; any other change takes the button away.
  document.addEventListener(
    'selectionchange',
    () => {
      if (
        pick.value !== undefined &&
        toQuote(window.getSelection()?.toString() ?? '') !== pick.value.quote
      ) {
        hide()
      }
    },
    { signal }
  )
  column?.addEventListener('pointerup', show, { signal })
  column?.addEventListener('keyup', show, { signal })
  column?.addEventListener('scroll', hide, { signal })
  window.addEventListener('resize', hide, { signal })

  return () => listeners.abort()
}

function readSelection(column: HTMLElement | null): Pick | undefined {
  const selection = window.getSelection()

  if (
    column === null ||
    selection === null ||
    selection.isCollapsed ||
    selection.rangeCount === 0
  ) {
    return undefined
  }

  const range = selection.getRangeAt(0)
  const quote = toQuote(selection.toString())

  if (quote.length < QUOTE_MIN_CHARS || !column.contains(range.commonAncestorContainer)) {
    return undefined
  }

  const rect = range.getBoundingClientRect()
  const above = rect.top - BUTTON_HEIGHT_PX - BUTTON_GAP_PX
  const top = above >= VIEWPORT_GUTTER_PX ? above : rect.bottom + BUTTON_GAP_PX
  const centre = rect.left + rect.width / 2
  const nearest = BUTTON_HALF_WIDTH_PX + VIEWPORT_GUTTER_PX

  return {
    quote,
    left: Math.min(Math.max(centre, nearest), window.innerWidth - nearest),
    top: Math.min(top, window.innerHeight - BUTTON_HEIGHT_PX - VIEWPORT_GUTTER_PX),
  }
}

// What the model is asked about carries no footnote marks and no line breaks.
function toQuote(selected: string): string {
  const quote = selected.replace(CITATION_MARK, '').replace(WHITESPACE, ' ').trim()

  return quote.length > QUOTE_MAX_CHARS
    ? `${quote.slice(0, QUOTE_MAX_CHARS - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`
    : quote
}
